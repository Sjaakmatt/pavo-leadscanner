// Scraper 02 (productie) — Rechtspraak.nl arbeidsrecht.
// Pattern A: HTTP + XML parsing. Geen Playwright nodig.

import { XMLParser } from "fast-xml-parser";
import {
  anthropic,
  estimateUsd,
  extractJson,
  makeSignal,
  scraperModel,
  textOfContent,
  type CompanyForScraper,
  type ScraperRunResult,
  type ScraperSignal,
} from "./shared";

const BRON_TYPE = "rechtspraak";

const SEARCH_URL = (naam: string) =>
  `https://uitspraken.rechtspraak.nl/InzienResultaat?zoekterm=${encodeURIComponent(`"${naam}"`)}&selectie=Rechtsgebied&filters=Arbeidsrecht`;

const CONTENT_URL = (ecli: string) =>
  `https://data.rechtspraak.nl/uitspraken/content?id=${encodeURIComponent(ecli)}`;

const ECLI_RE = /ECLI:NL:[A-Z]{2,5}:\d{4}:[A-Z0-9]+/g;

const xml = new XMLParser({ ignoreAttributes: false });

const CLASSIFY_SYSTEM = `Je bent PAVO's juridisch-HR analist. Geef een JSON-array van signalen. Toegestane categorieën:
- arbeidsrechtzaak_recent (cluster 1): min. één zaak in 12 mnd.
- arbeidsrechtzaak_patroon (cluster 1): 3+ zaken in 24 mnd, terugkerend thema.
- negatieve_reviews_chaos (cluster 1): expliciet verloop-patroon in uitspraak.
- verzuim_burnout_signalen (cluster 1): expliciete ziek/burnout-geschillen.
Output-schema: [{"categorie":"...","sterkte":0-100,"confidence":0-100,"observatie":"NL 20 woorden","bewijs":["citaat/ECLI"]}]. Leeg [] bij niks. Geen fences.`;

function stringifyXml(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.map(stringifyXml).join(" ");
  if (typeof node === "object") {
    return Object.entries(node as Record<string, unknown>)
      .filter(([k]) => !k.startsWith("@_"))
      .map(([, v]) => stringifyXml(v))
      .join(" ");
  }
  return "";
}

async function fetchEcliContent(ecli: string): Promise<string | null> {
  try {
    const res = await fetch(CONTENT_URL(ecli), {
      headers: { Accept: "application/xml" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    const doc = xml.parse(body) as Record<string, unknown>;
    const root = (doc["open:open"] ?? doc) as Record<string, unknown>;
    const uit = (root["uitspraak"] ?? root["conclusie"]) as unknown;
    return stringifyXml(uit);
  } catch {
    return null;
  }
}

export async function runRechtspraakScraper(
  company: CompanyForScraper,
): Promise<ScraperRunResult> {
  const t0 = Date.now();
  let eclis: string[] = [];
  const namesTried: string[] = [];
  const names = [company.naam, ...company.zoeknamen].slice(0, 4);
  for (const term of names) {
    namesTried.push(term);
    try {
      const res = await fetch(SEARCH_URL(term), { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const html = await res.text();
      const found = [...new Set(html.match(ECLI_RE) ?? [])].slice(0, 10);
      if (found.length > 0) {
        eclis = found;
        break;
      }
    } catch {
      // try next term
    }
  }
  if (eclis.length === 0) {
    return {
      signals: [],
      method: "api",
      success: true,
      durationMs: Date.now() - t0,
      cost: { inputTokens: 0, outputTokens: 0, usd: 0 },
      debug: { namesTried, reason: "geen ECLIs" },
    };
  }

  const bodies: { ecli: string; body: string }[] = [];
  for (const e of eclis) {
    const b = await fetchEcliContent(e);
    if (b && b.length > 200) bodies.push({ ecli: e, body: b.slice(0, 4_000) });
  }
  if (bodies.length === 0) {
    return {
      signals: [],
      method: "api",
      success: false,
      error: "ECLIs zonder ophaal-bare content",
      durationMs: Date.now() - t0,
      cost: { inputTokens: 0, outputTokens: 0, usd: 0 },
      debug: { eclis },
    };
  }

  const payload = bodies.map((b, i) => `### ${i + 1} ${b.ecli}\n${b.body}`).join("\n\n");
  const res = await anthropic().messages.create({
    model: scraperModel(),
    max_tokens: 1200,
    system: CLASSIFY_SYSTEM,
    messages: [{ role: "user", content: `Bedrijf: ${company.naam}\nZaken: ${bodies.length}\n\n${payload}` }],
  });
  let parsed: Array<{ categorie: string; sterkte: number; confidence: number; observatie: string; bewijs?: string[] }> = [];
  try {
    const j = extractJson<typeof parsed | { signalen: typeof parsed }>(textOfContent(res.content));
    parsed = Array.isArray(j) ? j : Array.isArray(j?.signalen) ? j.signalen : [];
  } catch {
    // fine — no signals extracted
  }

  const signals: ScraperSignal[] = parsed.map((p) =>
    makeSignal(
      {
        ...p,
        bron_url: `https://uitspraken.rechtspraak.nl/#zoekresultaat?zoekterm=${encodeURIComponent(company.naam)}`,
      },
      BRON_TYPE,
    ),
  );
  return {
    signals,
    method: "api",
    success: true,
    durationMs: Date.now() - t0,
    cost: {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      usd: estimateUsd(res.usage.input_tokens, res.usage.output_tokens),
    },
    debug: { eclis, namesTried },
  };
}
