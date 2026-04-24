// Scraper 06 (productie) — Google News RSS. HTTP + fast-xml-parser.

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

const BRON_TYPE = "news";

const RSS_URL = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=nl&gl=NL&ceid=NL:nl`;

const xml = new XMLParser({ ignoreAttributes: false });

const CLASSIFY_SYSTEM = `PAVO newswire-analist. JSON-array signalen uit titels + samenvattingen:
- snelle_groei (cluster 1), nieuwe_managementlaag (cluster 1), internationale_uitbreiding (cluster 1), verzuim_burnout_signalen (cluster 1, reorganisaties/ontslagrondes).
Schema: [{"categorie":"...","sterkte":0-100,"confidence":0-100,"observatie":"NL 25 woorden","bewijs":["citaat"]}]. Homonieme bedrijven negeren. Leeg [] bij niks.`;

type RssItem = { title: string; link: string; pubDate: string; description: string };

function parseRss(body: string): RssItem[] {
  try {
    const doc = xml.parse(body) as { rss?: { channel?: { item?: unknown } } };
    const raw = doc.rss?.channel?.item;
    const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<Record<string, unknown>>;
    return items.map((i) => ({
      title: String(i.title ?? ""),
      link: String(i.link ?? ""),
      pubDate: String(i.pubDate ?? ""),
      description: String(i.description ?? "").replace(/<[^>]+>/g, " "),
    }));
  } catch {
    return [];
  }
}

function isRecent(pubDate: string, months = 18): boolean {
  const t = new Date(pubDate).getTime();
  if (!Number.isFinite(t)) return true;
  return t >= Date.now() - months * 30 * 86_400_000;
}

export async function runNewsScraper(company: CompanyForScraper): Promise<ScraperRunResult> {
  const t0 = Date.now();
  const names = [company.naam, ...company.zoeknamen].slice(0, 4);
  const query = names.map((n) => `"${n}"`).join(" OR ");
  const bronUrl = RSS_URL(query);

  let body = "";
  try {
    const res = await fetch(bronUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return {
        signals: [],
        method: "rss",
        success: false,
        error: `HTTP ${res.status}`,
        durationMs: Date.now() - t0,
        cost: { inputTokens: 0, outputTokens: 0, usd: 0 },
      };
    }
    body = await res.text();
  } catch (err) {
    return {
      signals: [],
      method: "rss",
      success: false,
      error: String(err),
      durationMs: Date.now() - t0,
      cost: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }

  const items = parseRss(body).filter((i) => isRecent(i.pubDate)).slice(0, 15);
  if (items.length === 0) {
    return {
      signals: [],
      method: "rss",
      success: true,
      durationMs: Date.now() - t0,
      cost: { inputTokens: 0, outputTokens: 0, usd: 0 },
      debug: { reason: "geen recente items" },
    };
  }

  const formatted = items.map((it, i) => `${i + 1}. ${it.title}\n   ${it.pubDate}\n   ${it.description.slice(0, 300)}`).join("\n");
  const res = await anthropic().messages.create({
    model: scraperModel(),
    max_tokens: 1200,
    system: CLASSIFY_SYSTEM,
    messages: [{ role: "user", content: `Bedrijf: ${company.naam}\nVarianten: ${names.join(", ")}\nItems: ${items.length}\n\n${formatted}` }],
  });
  let parsed: Array<{ categorie: string; sterkte: number; confidence: number; observatie: string; bewijs?: string[] }> = [];
  try {
    const j = extractJson<typeof parsed | { signalen: typeof parsed }>(textOfContent(res.content));
    parsed = Array.isArray(j) ? j : Array.isArray(j?.signalen) ? j.signalen : [];
  } catch {
    // fine
  }
  const signals: ScraperSignal[] = parsed.map((p) => makeSignal({ ...p, bron_url: bronUrl }, BRON_TYPE));
  return {
    signals,
    method: "rss",
    success: true,
    durationMs: Date.now() - t0,
    cost: {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      usd: estimateUsd(res.usage.input_tokens, res.usage.output_tokens),
    },
    debug: { itemsUsed: items.length },
  };
}
