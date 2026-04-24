// Scraper 6 — Google News RSS.
//
// Free alternative to SerpAPI. Google News exposes a well-behaved RSS
// endpoint per query; parsing it is safe and the data is explicitly meant
// for public consumption.
//
// Strategy (pattern A):
//   1. HTTP GET https://news.google.com/rss/search?q=...&hl=nl&gl=NL&ceid=NL:nl
//   2. Parse RSS with fast-xml-parser.
//   3. Filter items to the last 18 months.
//   4. Send title+snippet+link batch to Claude for signal classification.

import { XMLParser } from "fast-xml-parser";
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

const SCRAPER_NAME = "06-google-news";

const RSS_URL = (naam: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`"${naam}"`)}&hl=nl&gl=NL&ceid=NL:nl`;

type RssItem = {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  source?: string;
};

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

function parseRss(body: string): RssItem[] {
  try {
    const doc = xml.parse(body);
    const raw = doc?.rss?.channel?.item;
    const items: unknown[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return items.map((it) => {
      const i = it as Record<string, unknown>;
      const source = i["source"];
      const sourceText =
        typeof source === "string"
          ? source
          : typeof (source as Record<string, unknown> | undefined)?.["#text"] === "string"
            ? ((source as Record<string, unknown>)["#text"] as string)
            : undefined;
      return {
        title: stringOr(i["title"], ""),
        link: stringOr(i["link"], ""),
        pubDate: stringOr(i["pubDate"], ""),
        description: stringOr(i["description"], "").replace(/<[^>]+>/g, " "),
        source: sourceText,
      };
    });
  } catch {
    return [];
  }
}

function stringOr(v: unknown, fallback: string): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    const t = (v as Record<string, unknown>)["#text"];
    return typeof t === "string" ? t : fallback;
  }
  return fallback;
}

function isRecent(pubDate: string, maxMonths: number): boolean {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return true; // keep unparsable dates rather than silently drop
  const cutoff = Date.now() - maxMonths * 30 * 24 * 60 * 60 * 1000;
  return d.getTime() >= cutoff;
}

const CLASSIFY_SYSTEM = `Je bent PAVO's newswire-analist. Je krijgt nieuwsberichten over één Nederlands MKB-bedrijf en moet PAVO-signalen afleiden.

Toegestane categorieën:
- snelle_groei (cluster 1): investering, overname, opening nieuwe vestiging, forse omzetgroei.
- nieuwe_managementlaag (cluster 1): CEO- of directeurwissel, nieuwe COO/CHRO/CFO benoeming.
- internationale_uitbreiding (cluster 1): buitenlandse expansie of export-kopstuk.
- verzuim_burnout_signalen (cluster 1): reorganisatie, gedwongen ontslagen, personeelsstop, stakingen.
- snelle_groei mag je combineren met klein_team_in_groei (cluster 3) als het duidelijk een klein bedrijf betreft.

Voor elk signaal:
{
  "categorie": "<categorie>",
  "sterkte": 0-100,
  "confidence": 0-100,
  "observatie": "Nederlandse uitleg in <= 25 woorden",
  "bewijs": ["woordelijk citaat uit de berichttitel of samenvatting"]
}

Regels:
- Alleen echt relevante berichten tellen. Homonieme bedrijfsnamen negeren (bv. een persoon of ander bedrijf met gelijke naam).
- Antwoord leeg array [] als niks bruikbaar.
- Geen markdown-fences.`;

type RawSignal = {
  categorie: SignaalCategorie;
  sterkte: number;
  confidence: number;
  observatie: string;
  bewijs?: string[];
};

function parseSignals(raw: string): RawSignal[] {
  try {
    const parsed = extractJson<RawSignal[] | { signalen: RawSignal[] }>(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.signalen)) return parsed.signalen;
    return [];
  } catch {
    return [];
  }
}

async function classifyItems(
  company: TestCompany,
  items: RssItem[],
): Promise<{ signals: Signaal[]; inputTokens: number; outputTokens: number }> {
  const client = getAnthropic();
  const body = items
    .map(
      (it, i) =>
        `### ${i + 1}. ${it.title}\nbron: ${it.source ?? "onbekend"}\ndatum: ${it.pubDate}\nsamenvatting: ${it.description.slice(0, 500)}\nlink: ${it.link}`,
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
              content: `Bedrijf: ${company.naam} (KvK ${company.kvk})\nAantal nieuwsitems: ${items.length}\n\n${body}`,
            },
          ],
        }),
        30_000,
        "news-classify",
      ),
    { maxAttempts: 2, label: "news-classify" },
  );
  const parsed = parseSignals(textOf(response.content));
  return {
    signals: parsed.map((p) =>
      makeSignal({
        categorie: p.categorie,
        sterkte: p.sterkte,
        confidence: p.confidence,
        observatie: p.observatie,
        bewijs: p.bewijs,
        bron_url: RSS_URL(company.naam),
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
  let res;
  try {
    res = await withRetry(
      () => httpGet(RSS_URL(company.naam), { timeoutMs: 20_000 }),
      { maxAttempts: 3, label: "news-rss" },
    );
  } catch (err) {
    return {
      success: false,
      durationMs: Date.now() - t0,
      hitCount: 0,
      signals: [],
      cost: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
      error: `RSS fetch faalde: ${errMessage(err)}`,
    };
  }

  if (res.status !== 200) {
    await writeDebug(`06-status-${company.id}`, {
      status: res.status,
      body: res.body.slice(0, 2_000),
    });
    return {
      success: false,
      durationMs: Date.now() - t0,
      hitCount: 0,
      signals: [],
      cost: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
      error: `HTTP ${res.status}`,
    };
  }

  const items = parseRss(res.body)
    .filter((it) => isRecent(it.pubDate, 18))
    .slice(0, 15);

  if (items.length === 0) {
    return {
      success: true,
      durationMs: Date.now() - t0,
      hitCount: 0,
      signals: [],
      cost: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
      debug: { reason: "geen recente nieuwsitems" },
    };
  }

  const { signals, inputTokens, outputTokens } = await classifyItems(
    company,
    items,
  );

  return {
    success: true,
    durationMs: Date.now() - t0,
    hitCount: items.length,
    signals,
    cost: {
      inputTokens,
      outputTokens,
      estimatedUsd: estimateCostUsd(inputTokens, outputTokens),
    },
    debug: {
      itemsConsidered: items.length,
      firstTitle: items[0]?.title,
    },
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
        const hitBedrijven = results.filter((r) => r.hitCount > 0).length;
        if (rate >= 0.95)
          return {
            verdict: "productie_klaar",
            toelichting: `RSS is publiek bedoeld voor consumptie en levert ${hitBedrijven}/${results.length} bedrijven met nieuwshits. Stabiele gratis bron.`,
          };
        if (rate >= 0.7)
          return {
            verdict: "werkt_met_aanpassing",
            toelichting: `${(rate * 100).toFixed(0)}% haalbaar. Rate-limit bij > 50 requests per minuut mogelijk — batch via throttle.`,
          };
        if (rate >= 0.3)
          return {
            verdict: "fragiel",
            toelichting: "RSS-endpoint reageerde wisselend — ongewoon, mogelijk netwerk-probleem.",
          };
        return {
          verdict: "niet_werkbaar",
          toelichting: "RSS-endpoint onbereikbaar of retourneert consistent fouten.",
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
