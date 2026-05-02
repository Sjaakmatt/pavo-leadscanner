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

// Customer-friendly NL labels voor de chat-UI. Tool-namen zijn intern
// technisch (snake_case); we tonen aan de gebruiker een actie-zin in
// het Nederlands ("Vacatures ophalen van de website…" i.p.v.
// "scrape_vacancies…").
export const TOOL_LABELS_NL: Record<string, string> = {
  get_kvk_basisprofiel: "KvK-basisprofiel ophalen",
  get_kvk_snapshot_history: "Historische KvK-snapshots vergelijken",
  scrape_vacancies: "Live vacatures ophalen van de bedrijfssite",
  search_court_cases: "Rechtspraak.nl doorzoeken",
  search_news: "Bedrijfsnieuws doorzoeken",
  get_lead_signals_raw: "Onderliggende signaaldata ophalen",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS_NL[name] ?? name;
}

// Belangrijk: ALLE input-velden zijn optioneel. De chat-call gaat over één
// specifieke lead — kvk, naam en website worden automatisch ingevuld vanuit
// de lead-context (companies-tabel) als de agent ze niet meegeeft. De agent
// moet ze ALLEEN expliciet meegeven als het over een ander bedrijf gaat
// (bv. moederonderneming, dochters).
export const LEAD_TOOLS: Tool[] = [
  {
    name: "get_kvk_basisprofiel",
    description:
      "Haal het verse KvK-basisprofiel op voor DIT bedrijf (FTE-klasse, vestigingen, bestuurders, rechtsvorm, oprichtingsdatum). Roep aan zonder argumenten — kvk wordt automatisch ingevuld. Kost €0,02 per call.",
    input_schema: {
      type: "object",
      properties: {
        kvk: {
          type: "string",
          description: "OPTIONEEL — alleen invullen voor een ander bedrijf dan deze lead.",
        },
      },
    },
  },
  {
    name: "get_kvk_snapshot_history",
    description:
      "Lees historische KvK-snapshots voor DIT bedrijf uit eerdere scans. Voor 'is het FTE gegroeid?', 'wanneer is bestuurder gewisseld?'. Geeft max 10 snapshots terug. Roep aan zonder argumenten.",
    input_schema: {
      type: "object",
      properties: {
        kvk: { type: "string", description: "OPTIONEEL — default deze lead." },
      },
    },
  },
  {
    name: "scrape_vacancies",
    description:
      "Scrape live vacatures van DEZE lead's bedrijfssite (sitemap + JSON-LD + ATS + content-classifier). Voor 'welke vacatures staan er nu open?'. Roep aan zonder argumenten — de URL wordt opgezocht in de companies-tabel (zelfde URL die de scan gebruikte).",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "OPTIONEEL — alleen meegeven voor een specifiek ander domein.",
        },
      },
    },
  },
  {
    name: "search_court_cases",
    description:
      "Zoek rechtspraak.nl-uitspraken voor DEZE lead, optioneel met rechtsgebied-filter (bv. 'arbeidsrecht'). Roep aan met alleen legal_area; bedrijfsnaam wordt auto-ingevuld.",
    input_schema: {
      type: "object",
      properties: {
        company_names: {
          type: "array",
          items: { type: "string" },
          description: "OPTIONEEL — default deze lead's naam. Geef array mee voor handelsnamen of dochters.",
        },
        legal_area: {
          type: "string",
          description: "Optioneel: 'arbeidsrecht', 'belastingrecht', etc.",
        },
      },
    },
  },
  {
    name: "search_news",
    description:
      "Zoek recente Google News artikelen over DEZE lead. Voor overnames, koerswijzigingen, persberichten. Roep aan zonder argumenten.",
    input_schema: {
      type: "object",
      properties: {
        company_name: {
          type: "string",
          description: "OPTIONEEL — default deze lead's naam.",
        },
        max_results: { type: "number", description: "Default 10." },
      },
    },
  },
  {
    name: "get_lead_signals_raw",
    description:
      "Alle ruwe signal-records voor DEZE lead uit de database (categorie, cluster, sterkte, confidence, observatie, bron, bewijs, detected_at). Voor 'wat is het exacte bewijs?', 'op welke datum?'. Roep aan zonder argumenten.",
    input_schema: {
      type: "object",
      properties: {
        kvk: { type: "string", description: "OPTIONEEL — default deze lead." },
        ttl_days: { type: "number", description: "Lookback dagen, default 90." },
      },
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

/**
 * Pre-gebonden lead-context: chat-route kent kvk + naam (uit URL-param +
 * Lead-snapshot) en kan website opzoeken in de companies-tabel. Tools
 * gebruiken deze als default zodat de agent niet hoeft te raden welke URL
 * de scan gebruikte (Lead-type heeft geen website-veld).
 */
export interface LeadContext {
  kvk: string;
  naam: string;
  websiteUrl: string | null;
}

export async function loadLeadContext(
  kvk: string,
  naam: string,
): Promise<LeadContext> {
  const supabase = supabaseServer();
  const { data } = await supabase
    .from("companies")
    .select("website_url")
    .eq("kvk", kvk)
    .maybeSingle();
  const raw = (data as { website_url?: unknown } | null)?.website_url;
  const websiteUrl = typeof raw === "string" && raw.length > 0 ? raw : null;
  return { kvk, naam, websiteUrl };
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
  leadCtx: LeadContext,
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

  // Lead-context als default voor inputs die de agent kan/moet weglaten:
  // de chat-call gaat over één specifieke lead, dus kvk/naam/website
  // hoeven niet door de agent geraden te worden.
  const kvk = stringOrNull(input.kvk) ?? leadCtx.kvk;
  const url = stringOrNull(input.url) ?? leadCtx.websiteUrl;

  try {
    let result: unknown;
    switch (name) {
      case "get_kvk_basisprofiel":
        result = await getBedrijven().kvkBasisprofiel(ctx, kvk);
        break;
      case "get_kvk_snapshot_history":
        result = await fetchKvkSnapshotHistory(kvk);
        break;
      case "scrape_vacancies":
        if (!url) {
          return errorResult(
            block.id,
            name,
            `Geen website bekend voor ${leadCtx.naam} (kvk ${leadCtx.kvk}) in companies-tabel. Geef expliciet een url mee.`,
          );
        }
        result = await getVacatures().extractVacanciesFromCompanySite(ctx, { url });
        break;
      case "search_court_cases":
        result = await getJuridisch().searchCourtCases(ctx, {
          company_names: stringArrayOrNull(input.company_names) ?? [leadCtx.naam],
          legal_area: stringOrNull(input.legal_area) ?? undefined,
        });
        break;
      case "search_news":
        result = await getNews().searchCompanyNews(ctx, {
          company_name: stringOrNull(input.company_name) ?? leadCtx.naam,
          max_results: typeof input.max_results === "number" ? input.max_results : 10,
        });
        break;
      case "get_lead_signals_raw":
        result = await fetchSignalsRaw(
          kvk,
          typeof input.ttl_days === "number" ? input.ttl_days : 90,
        );
        break;
      default:
        return errorResult(block.id, name, `Onbekende tool: ${name}`);
    }
    return {
      toolUseId: block.id,
      toolName: name,
      isError: false,
      content: JSON.stringify(result, null, 2).slice(0, 12_000),
    };
  } catch (err) {
    return errorResult(
      block.id,
      name,
      `Tool ${name} faalde: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function errorResult(toolUseId: string, toolName: string, content: string): ToolResult {
  return { toolUseId, toolName, isError: true, content };
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function stringArrayOrNull(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  if (v.some((x) => typeof x !== "string")) return null;
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
