// Scraper 2 — Rechtspraak.nl (Dutch case-law search for employment cases).
//
// Strategy (pattern A from the briefing):
//   1. Direct HTTP GET on the legacy public search page (InzienResultaat)
//      filtered on Arbeidsrecht — it returns HTML we can parse for ECLI
//      identifiers. The modern data.rechtspraak.nl Atom feed has no
//      full-text search on party names, so HTML parsing of the search
//      page is the pragmatic route.
//   2. For each ECLI, fetch the content API (data.rechtspraak.nl/uitspraken/content?id=ECLI…).
//   3. Filter on pseudonimisering rules (BV/NV only, skip obvious natural-
//      person names in company string).
//   4. Send the case body to Claude for PAVO signal classification.
//
// The scraper emits arbeidsrechtzaak_recent / arbeidsrechtzaak_patroon
// and may escalate to negatieve_reviews_chaos if the facts warrant it.

import { XMLParser } from "fast-xml-parser";
import { chromium } from "playwright";
import {
  errMessage,
  estimateCostUsd,
  extractJson,
  getAnthropic,
  getModel,
  httpGet,
  makeSignal,
  runScraperOverCompanies,
  textOf,
  withRetry,
  withTimeout,
  writeDebug,
} from "../shared/utils.ts";
import type {
  CompanyResult,
  Signaal,
  SignaalCategorie,
  TestCompany,
} from "../shared/types.ts";
import { TEST_COMPANIES } from "../shared/test-companies.ts";

const SCRAPER_NAME = "02-rechtspraak";

const SEARCH_URL = (naam: string) =>
  `https://uitspraken.rechtspraak.nl/InzienResultaat?zoekterm=${encodeURIComponent(
    `"${naam}"`,
  )}&selectie=Rechtsgebied&filters=Arbeidsrecht`;

const CONTENT_URL = (ecli: string) =>
  `https://data.rechtspraak.nl/uitspraken/content?id=${encodeURIComponent(ecli)}`;

// ECLI:NL:…:{year}:{seq}  (we deliberately match a broad alphabet because
// the Raad publishes ECLIs from many courts with slightly different shapes).
const ECLI_REGEX = /ECLI:NL:[A-Z]{2,5}:\d{4}:[A-Z0-9]+/g;

// Heuristic to flag likely-natural-person company strings that will be
// pseudonimiseerd in rechtspraak output. Skip these to avoid misleading
// classifications (the case won't mention the company name).
function isLikelyPersonName(naam: string): boolean {
  const lc = naam.toLowerCase();
  if (/\bvof\b|\bmaatschap\b|eenmanszaak/.test(lc)) return true;
  // "Ed Jansen Horecaverhuur BV" — two-word personal start followed by BV
  const stripped = lc
    .replace(/\b(b\.?v\.?|n\.?v\.?|holding|groep|group)\b/g, "")
    .trim();
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words[0].length >= 2 && words[1].length >= 2) {
    const commonFirstNames = [
      "jan",
      "piet",
      "ed",
      "henk",
      "kees",
      "peter",
      "johan",
      "willem",
      "frank",
      "martin",
      "gerrit",
    ];
    if (commonFirstNames.includes(words[0])) return true;
  }
  return false;
}

async function renderSearchViaPlaywright(naam: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    });
    const page = await ctx.newPage();
    await page.goto(SEARCH_URL(naam), {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await page.waitForTimeout(2_000);
    // Grab the rendered body text; ECLIs in the SPA end up as rendered text.
    return await page.innerText("body").catch(() => "");
  } finally {
    await browser.close();
  }
}

function parseEclisFromHtml(html: string, max = 10): string[] {
  const seen = new Set<string>();
  const matches = html.match(ECLI_REGEX) || [];
  for (const m of matches) {
    seen.add(m);
    if (seen.size >= max) break;
  }
  return [...seen];
}

type Uitspraak = {
  ecli: string;
  datum?: string;
  titel?: string;
  body: string;
};

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

async function fetchUitspraak(ecli: string): Promise<Uitspraak | null> {
  const res = await httpGet(CONTENT_URL(ecli), { timeoutMs: 20_000 });
  if (res.status !== 200 || !res.body) return null;
  try {
    const doc = xml.parse(res.body);
    // The XML wraps content in <open:open><rdf:RDF>…</rdf:RDF><uitspraak>…</uitspraak></open:open>
    const root = (doc["open:open"] || doc) as Record<string, unknown>;
    const uit = (root["uitspraak"] || root["conclusie"]) as
      | Record<string, unknown>
      | undefined;
    const body = uit ? stringifyXmlText(uit) : stringifyXmlText(root);
    const rdf = (root["rdf:RDF"] as Record<string, unknown> | undefined)?.[
      "rdf:Description"
    ] as Record<string, unknown> | undefined;
    const datum =
      (rdf?.["dcterms:date"] as string | undefined) ||
      (rdf?.["dcterms:issued"] as string | undefined);
    const titel = rdf?.["dcterms:title"] as string | undefined;
    return { ecli, datum, titel, body };
  } catch {
    return null;
  }
}

function stringifyXmlText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.map(stringifyXmlText).join(" ");
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    return Object.entries(obj)
      .filter(([k]) => !k.startsWith("@_"))
      .map(([, v]) => stringifyXmlText(v))
      .join(" ");
  }
  return "";
}

const CLASSIFY_SYSTEM = `Je bent PAVO's jurisch-HR analist. Je krijgt meerdere arbeidsrechtelijke uitspraken over één bedrijf en moet PAVO-signalen afleiden.

Gebruik UITSLUITEND deze categorieën:
- arbeidsrechtzaak_recent (cluster 1): minimaal één arbeidsrechtelijke zaak in de afgelopen 12 maanden.
- arbeidsrechtzaak_patroon (cluster 1): 3+ zaken in 24 maanden of terugkerend thema (bv. meerdere ontslagzaken).
- negatieve_reviews_chaos (cluster 1): gebruik ALLEEN als de uitspraak zelf een patroon van conflicten, hoog verloop of chaos beschrijft.
- verzuim_burnout_signalen (cluster 1): gebruik ALLEEN bij expliciete zieken- of burnout-gerelateerde geschillen.

Voor elk relevant signaal geef je:
{
  "categorie": "<categorie>",
  "sterkte": 0-100,
  "confidence": 0-100,
  "observatie": "korte Nederlandse uitleg, benoem aantal zaken en kern",
  "bewijs": ["citaat of ECLI-referentie"]
}

Regels:
- Geen zaken van > 24 maanden geleden meetellen voor "patroon".
- Bij twijfel liever geen signaal dan een verzonnen signaal.
- Antwoord als JSON-array zonder markdown-fences.`;

type RawSignal = {
  categorie: SignaalCategorie;
  sterkte: number;
  confidence: number;
  observatie: string;
  bewijs?: string[];
};

async function classifyCases(
  company: TestCompany,
  cases: Uitspraak[],
): Promise<{ signals: Signaal[]; inputTokens: number; outputTokens: number }> {
  const client = getAnthropic();
  const summary = cases
    .map(
      (c, i) =>
        `### Zaak ${i + 1} — ${c.ecli}\nDatum: ${c.datum ?? "onbekend"}\nTitel: ${c.titel ?? "-"}\n\n${c.body.slice(0, 6_000)}`,
    )
    .join("\n\n");

  const response = await withRetry(
    () =>
      withTimeout(
        client.messages.create({
          model: getModel(),
          max_tokens: 1500,
          system: CLASSIFY_SYSTEM,
          messages: [
            {
              role: "user",
              content: `Bedrijf: ${company.naam} (KvK ${company.kvk})\nAantal gevonden uitspraken: ${cases.length}\n\n${summary}`,
            },
          ],
        }),
        30_000,
        "rechtspraak-classify",
      ),
    { maxAttempts: 2, label: "rechtspraak-classify" },
  );
  const raw = textOf(response.content);
  let parsed: RawSignal[] = [];
  try {
    const j = extractJson<RawSignal[] | { signalen: RawSignal[] }>(raw);
    parsed = Array.isArray(j)
      ? j
      : Array.isArray(j?.signalen)
        ? j.signalen
        : [];
  } catch {
    parsed = [];
  }

  return {
    signals: parsed.map((p) =>
      makeSignal({
        categorie: p.categorie,
        sterkte: p.sterkte,
        confidence: p.confidence,
        observatie: p.observatie,
        bewijs: p.bewijs,
        bron_url: `https://uitspraken.rechtspraak.nl/#zoekresultaat?zoekterm=${encodeURIComponent(company.naam)}`,
      }),
    ),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

async function handle(
  company: TestCompany,
): Promise<Omit<CompanyResult, "company">> {
  const t0 = Date.now();

  if (isLikelyPersonName(company.naam)) {
    return {
      success: true,
      durationMs: Date.now() - t0,
      hitCount: 0,
      signals: [],
      cost: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
      debug: { reason: "pseudonimisering verwacht — geskipt" },
    };
  }

  let html = "";
  try {
    const r = await withRetry(
      () => httpGet(SEARCH_URL(company.naam), { timeoutMs: 25_000 }),
      { maxAttempts: 3, label: "rechtspraak-search" },
    );
    html = r.body;
  } catch (err) {
    return {
      success: false,
      durationMs: Date.now() - t0,
      hitCount: 0,
      signals: [],
      cost: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
      error: `zoek-request faalde: ${errMessage(err)}`,
    };
  }

  let eclis = parseEclisFromHtml(html, 10);

  // The legacy search page is increasingly a SPA — when the static HTML
  // carries no ECLIs, fall back to Playwright and wait for the client
  // renderer to populate the result list.
  if (eclis.length === 0) {
    try {
      const rendered = await renderSearchViaPlaywright(company.naam);
      eclis = parseEclisFromHtml(rendered, 10);
    } catch (err) {
      await writeDebug(`02-playwright-error-${company.id}`, {
        error: errMessage(err),
      });
    }
  }

  if (eclis.length === 0) {
    return {
      success: true,
      durationMs: Date.now() - t0,
      hitCount: 0,
      signals: [],
      cost: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
      debug: { reason: "geen treffers in arbeidsrecht" },
    };
  }

  const cases: Uitspraak[] = [];
  for (const ecli of eclis) {
    try {
      const u = await fetchUitspraak(ecli);
      if (u && u.body.length > 200) cases.push(u);
    } catch (err) {
      await writeDebug(`02-content-error-${ecli.replace(/:/g, "_")}`, {
        error: errMessage(err),
      });
    }
  }

  if (cases.length === 0) {
    return {
      success: false,
      durationMs: Date.now() - t0,
      hitCount: eclis.length,
      signals: [],
      cost: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
      error: "ECLIs gevonden maar content-API leverde geen bruikbare tekst",
    };
  }

  const { signals, inputTokens, outputTokens } = await classifyCases(
    company,
    cases,
  );

  return {
    success: true,
    durationMs: Date.now() - t0,
    hitCount: cases.length,
    signals,
    cost: {
      inputTokens,
      outputTokens,
      estimatedUsd: estimateCostUsd(inputTokens, outputTokens),
    },
    debug: { eclis },
  };
}

async function main() {
  await runScraperOverCompanies(
    {
      scraperName: SCRAPER_NAME,
      handle,
      deriveVerdict: (results) => {
        const ok = results.filter((r) => r.success).length;
        const rate = ok / Math.max(results.length, 1);
        const hits = results.filter((r) => r.hitCount > 0).length;
        if (rate >= 0.9)
          return {
            verdict: "productie_klaar",
            toelichting: `API + HTML-parse werkt (${(rate * 100).toFixed(0)}%). ${hits}/${results.length} bedrijven met minimaal één zaak.`,
          };
        if (rate >= 0.7)
          return {
            verdict: "werkt_met_aanpassing",
            toelichting: `Werkt overwegend (${(rate * 100).toFixed(0)}%). Enkele gevallen falen op pseudonimisering of HTML-wijziging.`,
          };
        if (rate >= 0.3)
          return {
            verdict: "fragiel",
            toelichting: `Slagingspercentage ${(rate * 100).toFixed(0)}% — content-API leverde te vaak niks. Overwegen: login-vrije DOC-bundel downloaden.`,
          };
        return {
          verdict: "niet_werkbaar",
          toelichting: "Zowel search als content-API blokkeren of leveren leeg — niet bruikbaar in deze vorm.",
        };
      },
    },
    TEST_COMPANIES,
  );
}

main().catch((err) => {
  console.error("Fataal:", errMessage(err));
  process.exit(1);
});
