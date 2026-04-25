// Classificatie-laag: ruwe MCP-output → PAVO Signaal[].
//
// Eerste-orde verantwoordelijkheid van pavo-demo — de MCPs leveren ruwe
// HTML/tekst/XML, hier wordt het PAVO-domein-specifieke 3-cluster
// framework toegepast.
//
// Twee soorten classifiers:
//   - LLM-based (website/rechtspraak/nla/news): Claude Haiku 4.5 met
//     PAVO_CLASSIFICATION_PROMPT als system.
//   - Deterministisch (vacatures/insolventie): pure regels op getallen
//     en datums — cheaper en consistenter.

import { getAnthropicClient, classificationModel } from "./client";
import { PAVO_CLASSIFICATION_PROMPT } from "./prompts";
import type { Signaal, SignaalBronType } from "@/lib/scoring/types";
import type {
  WebsiteScrapeResult,
  RechtspraakRawResult,
  NlaRawResult,
  InsolventieRawResult,
  VacatureRawResult,
  NewsRawResult,
} from "@/lib/mcp/schemas";

type CompanyHandle = { kvk: string; naam: string };

// ---------- website -------------------------------------------------------

export async function classifyWebsite(
  company: CompanyHandle,
  result: WebsiteScrapeResult,
): Promise<Signaal[]> {
  if (result.pages.length === 0) return [];
  const context = result.pages
    .map((p) => `### ${p.url}\n${p.text.slice(0, 4000)}`)
    .join("\n\n---\n\n");
  const sitemapInfo = result.sitemap
    ? `\n\nSitemap: ${result.sitemap.vacancyUrls.length} vacancy-URLs / ${result.sitemap.totalUrls} totaal`
    : "";
  return classify(company, "website", `${context}${sitemapInfo}`);
}

// ---------- rechtspraak ---------------------------------------------------

export async function classifyRechtspraak(
  company: CompanyHandle,
  result: RechtspraakRawResult,
): Promise<Signaal[]> {
  if (result.uitspraken.length === 0) return [];
  const context = result.uitspraken
    .map(
      (u) =>
        `### ${u.ecli} (${u.datum})\n${u.titel ?? ""}\n${u.text.slice(0, 2000)}`,
    )
    .join("\n\n---\n\n");
  return classify(company, "rechtspraak", context);
}

// ---------- NLA -----------------------------------------------------------

export async function classifyNla(
  company: CompanyHandle,
  result: NlaRawResult,
): Promise<Signaal[]> {
  if (result.overtredingen.length === 0) return [];
  const context = result.overtredingen
    .map(
      (o) =>
        `Datum: ${o.datum} | Type: ${o.type} | Wetsartikel: ${
          o.wetsartikel ?? "onbekend"
        } | Bron: ${o.bron} | URL: ${o.url}`,
    )
    .join("\n");
  return classify(company, "nla", context);
}

// ---------- insolventie (deterministisch) --------------------------------

export function classifyInsolventie(
  _company: CompanyHandle,
  result: InsolventieRawResult,
): Signaal[] {
  if (result.zaken.length === 0) return [];
  // Bij insolventie altijd een failliet_of_surseance signaal — dit is
  // een uitsluit-flag voor scoring (zie scoring/index.ts override).
  return result.zaken.map((zaak) => ({
    categorie: "failliet_of_surseance" as const,
    cluster: "context" as const,
    sterkte: 100,
    confidence: 100,
    observatie: `${zaak.type} gestart op ${zaak.startdatum}`,
    bewijs: [zaak.bedrijfsnaam],
    bronUrl: zaak.url,
    bronType: "insolventie" as const,
  }));
}

// ---------- vacatures (deterministisch) ----------------------------------

export function classifyVacatures(
  _company: CompanyHandle,
  result: VacatureRawResult,
): Signaal[] {
  if (result.vacatures.length === 0) return [];
  const signalen: Signaal[] = [];

  if (result.vacatures.length >= 5) {
    signalen.push({
      categorie: "veel_open_vacatures",
      cluster: 2,
      sterkte: Math.min(100, result.vacatures.length * 10),
      confidence: 95,
      observatie: `${result.vacatures.length} open vacatures gevonden via sitemap/JSON-LD`,
      bewijs: result.vacatures.slice(0, 5).map((v) => `${v.title} (${v.url})`),
      bronType: "vacatures",
    });
  }

  if (result.oudsteVacature) {
    const daysOld = daysSince(result.oudsteVacature);
    if (daysOld > 45) {
      signalen.push({
        categorie: "langlopende_vacatures",
        cluster: 2,
        sterkte: Math.min(100, daysOld),
        confidence: 90,
        observatie: `Oudste vacature staat al ${daysOld} dagen open`,
        bewijs: [result.oudsteVacature],
        bronType: "vacatures",
      });
    }
  }

  return signalen;
}

// ---------- news ----------------------------------------------------------

export async function classifyNews(
  company: CompanyHandle,
  result: NewsRawResult,
): Promise<Signaal[]> {
  if (result.items.length === 0) return [];
  const context = result.items
    .map(
      (i) =>
        `**${i.title}** (${i.publishedAt})\n${i.snippet ?? ""}\n${i.url}`,
    )
    .join("\n\n");
  return classify(company, "news", context);
}

// ---------- generieke LLM-classifier -------------------------------------

async function classify(
  company: CompanyHandle,
  bronType: SignaalBronType,
  context: string,
): Promise<Signaal[]> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: classificationModel(),
    max_tokens: 2000,
    system: PAVO_CLASSIFICATION_PROMPT,
    messages: [
      {
        role: "user",
        content: `Bedrijf: ${company.naam} (KvK ${company.kvk})\nBron: ${bronType}\n\n${context}`,
      },
    ],
  });

  // flatMap i.p.v. een type-predicate: de SDK's TextBlock heeft een
  // verplichte `citations`-prop, dus het inline-predicate
  // `{ type: "text"; text: string }` smalt ContentBlock niet meer
  // correct af (TS error). Hier hebben we alleen `.text` nodig.
  const text = response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n");

  const json = extractJson(text);
  if (!json) return [];

  const raw = (json.signalen ?? []) as Array<Partial<Signaal>>;
  return raw
    .filter((s) => s && typeof s.categorie === "string")
    .map((s) => ({
      categorie: s.categorie as Signaal["categorie"],
      cluster: (s.cluster ?? "context") as Signaal["cluster"],
      sterkte: clamp(s.sterkte ?? 0, 0, 100),
      confidence: clamp(s.confidence ?? 0, 0, 100),
      observatie: s.observatie ?? "",
      bewijs: s.bewijs,
      bronUrl: s.bronUrl,
      bronType,
    }));
}

// Parse JSON uit Claude-output — fenced ```json``` of pure object/array.
function extractJson(text: string): { signalen?: unknown[] } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  if (start === -1) return null;
  const end = candidate.lastIndexOf("}");
  if (end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function daysSince(isoDate: string): number {
  const t = new Date(isoDate).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.floor((Date.now() - t) / 86_400_000);
}
