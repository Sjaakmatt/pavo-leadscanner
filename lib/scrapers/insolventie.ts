// Scraper 04 (productie) — Centraal Insolventieregister. Uitsluit-filter.
// SPA: Playwright primary met networkidle-wait, web_fetch fallback.

import {
  anthropic,
  estimateUsd,
  extractJson,
  makeSignal,
  scraperModel,
  textOfContent,
  withTimeout,
  type CompanyForScraper,
  type ScraperRunResult,
  type ScraperSignal,
} from "./shared";
import { extractBodyText, withPage } from "./playwright-runner";

const BRON_TYPE = "insolventie";

const SEARCH_URL = (naam: string) =>
  `https://insolventies.rechtspraak.nl/#!/zoeken/index?nm=${encodeURIComponent(naam)}`;

const CLASSIFY_SYSTEM = `Controleer Centraal Insolventieregister. Alleen ACTIEVE registraties tellen. JSON-array:
[{"categorie":"failliet_of_surseance","sterkte":95,"confidence":85-100,"observatie":"NL, type + datum","bewijs":["citaat"]}]
Leeg [] bij niks. Geen fences.`;

async function playwrightPath(company: CompanyForScraper): Promise<string | null> {
  try {
    return await withPage(async (page) => {
      const names = [company.naam, ...company.zoeknamen].slice(0, 3);
      const chunks: string[] = [];
      for (const term of names) {
        try {
          await page.goto(SEARCH_URL(term), { waitUntil: "networkidle", timeout: 25_000 });
          await page.waitForTimeout(2_000);
          const t = await extractBodyText(page, { maxChars: 5_000 });
          chunks.push(`# "${term}"\n${t}`);
          if (/faillissement|surseance/i.test(t) && !/geen.*resultaten/i.test(t)) break;
        } catch {
          // skip this term
        }
      }
      return chunks.join("\n\n");
    });
  } catch {
    return null;
  }
}

async function webFetchFallback(company: CompanyForScraper) {
  try {
    const res = await withTimeout(
      anthropic().beta.messages.create({
        model: scraperModel(),
        max_tokens: 800,
        betas: ["web-fetch-2025-09-10"],
        tools: [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 2 } as never],
        system: CLASSIFY_SYSTEM,
        messages: [
          { role: "user", content: `Zoek ${company.naam} op ${SEARCH_URL(company.naam)}` },
        ],
      }),
      40_000,
      "insol-webfetch",
    );
    return {
      text: textOfContent(res.content),
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  } catch {
    return null;
  }
}

function parseSignals(raw: string, bronUrl: string): ScraperSignal[] {
  try {
    const j = extractJson<Array<{ categorie: string; sterkte: number; confidence: number; observatie: string; bewijs?: string[] }> | { signalen: Array<{ categorie: string; sterkte: number; confidence: number; observatie: string; bewijs?: string[] }> }>(raw);
    const arr = Array.isArray(j) ? j : Array.isArray(j?.signalen) ? j.signalen : [];
    return arr.map((p) =>
      makeSignal({ ...p, categorie: "failliet_of_surseance", bron_url: bronUrl }, BRON_TYPE),
    );
  } catch {
    return [];
  }
}

export async function runInsolventieScraper(
  company: CompanyForScraper,
): Promise<ScraperRunResult> {
  const t0 = Date.now();
  const bronUrl = SEARCH_URL(company.naam);

  const pwText = await playwrightPath(company);
  if (pwText && pwText.length > 150) {
    const res = await anthropic().messages.create({
      model: scraperModel(),
      max_tokens: 600,
      system: CLASSIFY_SYSTEM,
      messages: [
        { role: "user", content: `Bedrijf: ${company.naam}\n\n${pwText.slice(0, 8_000)}` },
      ],
    });
    return {
      signals: parseSignals(textOfContent(res.content), bronUrl),
      method: "playwright",
      success: true,
      durationMs: Date.now() - t0,
      cost: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        usd: estimateUsd(res.usage.input_tokens, res.usage.output_tokens),
      },
    };
  }

  const wf = await webFetchFallback(company);
  if (wf) {
    return {
      signals: parseSignals(wf.text, bronUrl),
      method: "web_fetch",
      success: true,
      durationMs: Date.now() - t0,
      cost: {
        inputTokens: wf.inputTokens,
        outputTokens: wf.outputTokens,
        usd: estimateUsd(wf.inputTokens, wf.outputTokens),
      },
    };
  }
  return {
    signals: [],
    method: "playwright",
    success: false,
    error: "beide paden faalden",
    durationMs: Date.now() - t0,
    cost: { inputTokens: 0, outputTokens: 0, usd: 0 },
  };
}
