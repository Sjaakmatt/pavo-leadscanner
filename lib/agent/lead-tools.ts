// Tool-definities voor de lead-detail chat agent. Elke tool routeert naar
// een MCP-call of Supabase-query, met cost- en safety-bewaking:
//
//   - get_kvk_basisprofiel        → mcp-bedrijven (€0.02 per call)
//   - get_kvk_snapshot_history    → Supabase kvk_snapshots (gratis)
//   - scrape_vacancies            → mcp-vacatures (gratis)
//   - search_court_cases          → mcp-juridisch (gratis)
//   - search_news                 → mcp-news (gratis)
//   - get_lead_signals_raw        → Supabase signals (gratis)
//
// Per chat-sessie geldt een per-tool rate-limit zodat de agent niet
// expensive KvK-calls kan loopen.

import type { Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { McpHttpClient, type TenantContext } from "@/lib/mcp/client";
import { BedrijvenMcp, requireBedrijvenUrl } from "@/lib/mcp/bedrijven";
import { VacaturesMcp, requireVacaturesUrl } from "@/lib/mcp/vacatures";
import { JuridischMcp, requireJuridischUrl } from "@/lib/mcp/juridisch";
import { NewsMcp, requireNewsUrl } from "@/lib/mcp/news";
import { supabaseServer } from "@/lib/supabase/client";
import { buildTenantContext } from "@/lib/mcp/tenant";

export const LEAD_TOOLS: Tool[] = [
  {
    name: "get_kvk_basisprofiel",
    description:
      "Haal het verse KvK-basisprofiel op voor dit bedrijf (FTE-klasse, vestigingen, bestuurders, rechtsvorm, oprichtingsdatum). Gebruik dit als de gebruiker vraagt naar harde organisatie-feiten of structurele kenmerken die niet in de signalen staan. Kost €0,02 per call.",
    input_schema: {
      type: "object",
      properties: {
        kvk: {
          type: "string",
          description: "8-cijferig KvK-nummer (zonder spaties of streepjes).",
        },
      },
      required: ["kvk"],
    },
  },
  {
    name: "get_kvk_snapshot_history",
    description:
      "Lees historische KvK-snapshots voor dit bedrijf uit eerdere scans. Gebruik dit voor vragen over wijzigingen-in-de-tijd: 'is het FTE gegroeid?', 'wanneer is de bestuurder veranderd?', 'sinds wanneer wordt de jaarrekening laat gedeponeerd?'. Geeft tot 10 meest recente snapshots terug.",
    input_schema: {
      type: "object",
      properties: {
        kvk: { type: "string", description: "KvK-nummer." },
      },
      required: ["kvk"],
    },
  },
  {
    name: "scrape_vacancies",
    description:
      "Scrape de vacature-pagina's van een bedrijfssite live (sitemap + JSON-LD + ATS-detectie + content-classifier). Gebruik dit als de gebruiker vraagt naar OPENSTAANDE vacatures of welke functies men nu zoekt. Geeft titel, URL, datePosted en source terug.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Volledige bedrijfs-URL incl. https://, bv. https://www.acme.nl",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "search_court_cases",
    description:
      "Zoek rechtspraak.nl-uitspraken waarin dit bedrijf genoemd wordt, met optionele filter op rechtsgebied (bv. 'arbeidsrecht', 'belastingrecht'). Gebruik dit voor vragen over juridische conflicten, ontslagzaken, of arbeidsgeschillen.",
    input_schema: {
      type: "object",
      properties: {
        company_names: {
          type: "array",
          items: { type: "string" },
          description: "Eén of meerdere bedrijfsnamen (incl. handelsnamen).",
        },
        legal_area: {
          type: "string",
          description: "Optioneel: rechtsgebied-filter, bv. 'arbeidsrecht'.",
        },
      },
      required: ["company_names"],
    },
  },
  {
    name: "search_news",
    description:
      "Zoek recente nieuwsberichten over dit bedrijf via Google News RSS. Gebruik dit voor recent-events-vragen: overnames, koerswijzigingen, schandalen, persberichten.",
    input_schema: {
      type: "object",
      properties: {
        company_name: { type: "string", description: "Bedrijfsnaam." },
        max_results: {
          type: "number",
          description: "Max aantal resultaten, default 10.",
        },
      },
      required: ["company_name"],
    },
  },
  {
    name: "get_lead_signals_raw",
    description:
      "Haal alle ruwe signal-records voor deze lead uit de database (categorie, cluster, sterkte, confidence, observatie, bron, bewijs, detected_at). Gebruik dit als de gebruiker dieper wil graven dan de samenvatting in het system-prompt — bv. 'wat is het exacte bewijs voor signaal X?', 'op welke datum is dit gedetecteerd?'.",
    input_schema: {
      type: "object",
      properties: {
        kvk: { type: "string" },
        ttl_days: {
          type: "number",
          description: "Lookback in dagen, default 90.",
        },
      },
      required: ["kvk"],
    },
  },
];

// Per-tool budget per chat-sessie. Voorkomt dat een agent zichzelf in
// een loop praat en €€€ kost. Counts worden per request opnieuw geteld
// (dus per chat-call, niet per chat-sessie over meerdere requests).
const PER_REQUEST_TOOL_BUDGET: Record<string, number> = {
  get_kvk_basisprofiel: 2,
  get_kvk_snapshot_history: 1,
  scrape_vacancies: 1,
  search_court_cases: 2,
  search_news: 2,
  get_lead_signals_raw: 1,
};

export interface ToolUsageBudget {
  used: Record<string, number>;
}

export function newToolBudget(): ToolUsageBudget {
  return { used: {} };
}

function isOverBudget(name: string, budget: ToolUsageBudget): boolean {
  const limit = PER_REQUEST_TOOL_BUDGET[name] ?? 0;
  const used = budget.used[name] ?? 0;
  return used >= limit;
}

function bumpBudget(name: string, budget: ToolUsageBudget): void {
  budget.used[name] = (budget.used[name] ?? 0) + 1;
}

export interface ToolResult {
  toolUseId: string;
  toolName: string;
  content: string;
  isError: boolean;
}

// Singleton clients — vermijdt het herhaaldelijk opbouwen van HTTP-
// clients en circuit-breakers per chat-call.
let bedrijven: BedrijvenMcp | null = null;
let vacatures: VacaturesMcp | null = null;
let juridisch: JuridischMcp | null = null;
let news: NewsMcp | null = null;

function getBedrijven(): BedrijvenMcp {
  bedrijven ??= new BedrijvenMcp(new McpHttpClient(requireBedrijvenUrl()));
  return bedrijven;
}
function getVacatures(): VacaturesMcp {
  vacatures ??= new VacaturesMcp(new McpHttpClient(requireVacaturesUrl()));
  return vacatures;
}
function getJuridisch(): JuridischMcp {
  juridisch ??= new JuridischMcp(new McpHttpClient(requireJuridischUrl()));
  return juridisch;
}
function getNews(): NewsMcp {
  news ??= new NewsMcp(new McpHttpClient(requireNewsUrl()));
  return news;
}

export async function executeLeadTool(
  block: ToolUseBlock,
  budget: ToolUsageBudget,
): Promise<ToolResult> {
  const name = block.name;

  if (isOverBudget(name, budget)) {
    return {
      toolUseId: block.id,
      toolName: name,
      isError: true,
      content: `Budget overschreden voor ${name} in deze chat-call (max ${PER_REQUEST_TOOL_BUDGET[name] ?? 0}). Vraag de gebruiker of ze nog dieper willen, of vat samen met wat je al hebt.`,
    };
  }
  bumpBudget(name, budget);

  const ctx = buildTenantContext({ parentCallId: `chat:${block.id}` });
  const input = (block.input ?? {}) as Record<string, unknown>;

  try {
    let result: unknown;
    switch (name) {
      case "get_kvk_basisprofiel":
        result = await getBedrijven().kvkBasisprofiel(
          ctx,
          requireString(input, "kvk"),
        );
        break;
      case "get_kvk_snapshot_history":
        result = await fetchKvkSnapshotHistory(requireString(input, "kvk"));
        break;
      case "scrape_vacancies":
        result = await getVacatures().extractVacanciesFromCompanySite(ctx, {
          url: requireString(input, "url"),
        });
        break;
      case "search_court_cases":
        result = await getJuridisch().searchCourtCases(ctx, {
          company_names: requireStringArray(input, "company_names"),
          legal_area: typeof input.legal_area === "string" ? input.legal_area : undefined,
        });
        break;
      case "search_news":
        result = await getNews().searchCompanyNews(ctx, {
          company_name: requireString(input, "company_name"),
          max_results: typeof input.max_results === "number" ? input.max_results : 10,
        });
        break;
      case "get_lead_signals_raw":
        result = await fetchSignalsRaw(
          requireString(input, "kvk"),
          typeof input.ttl_days === "number" ? input.ttl_days : 90,
        );
        break;
      default:
        return {
          toolUseId: block.id,
          toolName: name,
          isError: true,
          content: `Onbekende tool: ${name}`,
        };
    }
    return {
      toolUseId: block.id,
      toolName: name,
      isError: false,
      content: JSON.stringify(result, null, 2).slice(0, 12_000),
    };
  } catch (err) {
    return {
      toolUseId: block.id,
      toolName: name,
      isError: true,
      content: `Tool ${name} faalde: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function requireString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Tool input '${key}' moet een non-empty string zijn.`);
  }
  return v;
}

function requireStringArray(
  input: Record<string, unknown>,
  key: string,
): string[] {
  const v = input[key];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new Error(`Tool input '${key}' moet een array van strings zijn.`);
  }
  return v as string[];
}

async function fetchKvkSnapshotHistory(kvk: string): Promise<unknown> {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("kvk_snapshots")
    .select("snapshot_at, fte_klasse, vestigingen, bestuurders, rechtsvorm, raw")
    .eq("kvk", kvk)
    .order("snapshot_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(`kvk_snapshots query: ${error.message}`);
  return { kvk, snapshots: data ?? [] };
}

async function fetchSignalsRaw(kvk: string, ttlDays: number): Promise<unknown> {
  const cutoff = new Date(Date.now() - ttlDays * 86_400_000).toISOString();
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("signals")
    .select(
      "categorie, cluster, sterkte, confidence, observatie, bron_type, bron_url, bewijs, detected_at",
    )
    .eq("kvk", kvk)
    .gte("detected_at", cutoff)
    .order("detected_at", { ascending: false });
  if (error) throw new Error(`signals query: ${error.message}`);
  return { kvk, ttl_days: ttlDays, count: data?.length ?? 0, signals: data ?? [] };
}
