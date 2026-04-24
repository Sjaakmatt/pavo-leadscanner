// Scraper 4 — Centraal Insolventieregister.
//
// Primary purpose: EXCLUDE filter. A company with an active bankruptcy
// (faillissement) or suspension of payment (surseance) is not a lead for
// PAVO. Anything we find is therefore coded as the meta-signal
// failliet_of_surseance (cluster = "context").
//
// Strategy (pattern B):
//   1. web_fetch on insolventies.rechtspraak.nl SPA search
//   2. Playwright fallback — the SPA is JS-rendered, so we wait for the
//      result list to appear before reading text.

import { chromium } from "playwright";
import {
  errMessage,
  estimateCostUsd,
  extractJson,
  getAnthropic,
  getModel,
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
  TestCompany,
} from "../shared/types.ts";
import { TEST_COMPANIES } from "../shared/test-companies.ts";

const SCRAPER_NAME = "04-insolventie";

const SEARCH_URL = (naam: string) =>
  `https://insolventies.rechtspraak.nl/#!/zoeken/index?nm=${encodeURIComponent(naam)}`;

const CLASSIFY_SYSTEM = `Je controleert of een Nederlands bedrijf in het Centraal Insolventieregister staat.

Output UITSLUITEND een JSON-array. Als er een actieve faillissement- of surseance-registratie is, geef je één signaal:
{
  "categorie": "failliet_of_surseance",
  "sterkte": 95,
  "confidence": 85-100,
  "observatie": "Actief <type> sinds <datum>, nummer <rechtbank-nummer indien zichtbaar>",
  "bewijs": ["kort citaat uit het zoekresultaat"]
}

Alleen ACTIEVE registraties tellen — afgesloten/opgeheven faillissementen negeer je.
Als niks zichtbaar is, antwoord met []. Geen markdown-fences.`;

async function tryWebFetch(company: TestCompany): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
} | null> {
  const client = getAnthropic();
  try {
    const response = await withRetry(
      () =>
        withTimeout(
          client.beta.messages.create({
            model: getModel(),
            max_tokens: 1024,
            betas: ["web-fetch-2025-09-10"],
            tools: [
              { type: "web_fetch_20250910", name: "web_fetch", max_uses: 2 } as never,
            ],
            system: CLASSIFY_SYSTEM,
            messages: [
              {
                role: "user",
                content: `Zoek "${company.naam}" (KvK ${company.kvk}) in het Centraal Insolventieregister: ${SEARCH_URL(company.naam)}\n\nControleer of er een actieve faillissement of surseance staat.`,
              },
            ],
          }),
          45_000,
          "insol-webfetch",
        ),
      { maxAttempts: 2, label: "insol-webfetch" },
    );
    return {
      text: textOf(response.content),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch (err) {
    await writeDebug(`04-webfetch-error-${company.id}`, {
      error: errMessage(err),
    });
    return null;
  }
}

async function tryPlaywright(company: TestCompany): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    });
    const page = await ctx.newPage();
    await page.goto(SEARCH_URL(company.naam), {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    // SPA: wait for the results list container to appear.
    await page
      .waitForSelector(".resultaten, .no-results, [data-result]", {
        timeout: 15_000,
      })
      .catch(() => {});
    await page.waitForTimeout(1_500);
    const body = await page.innerText("body").catch(() => "");
    return body.slice(0, 10_000);
  } finally {
    await browser.close();
  }
}

type RawSignal = {
  categorie: "failliet_of_surseance";
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

async function classifyText(
  company: TestCompany,
  text: string,
): Promise<{ signals: Signaal[]; inputTokens: number; outputTokens: number }> {
  const client = getAnthropic();
  const response = await withRetry(
    () =>
      withTimeout(
        client.messages.create({
          model: getModel(),
          max_tokens: 800,
          system: CLASSIFY_SYSTEM,
          messages: [
            {
              role: "user",
              content: `Bedrijf: ${company.naam}\nKvK: ${company.kvk}\n\nZoekresultaat-pagina:\n---\n${text}\n---`,
            },
          ],
        }),
        20_000,
        "insol-classify",
      ),
    { maxAttempts: 2, label: "insol-classify" },
  );
  const parsed = parseSignals(textOf(response.content));
  return {
    signals: parsed.map((p) =>
      makeSignal({
        categorie: "failliet_of_surseance",
        sterkte: p.sterkte,
        confidence: p.confidence,
        observatie: p.observatie,
        bewijs: p.bewijs,
        bron_url: SEARCH_URL(company.naam),
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
  let inputTokens = 0;
  let outputTokens = 0;
  let signals: Signaal[] = [];
  let success = false;
  let pathTaken: "web_fetch" | "playwright" | "none" = "none";

  const wf = await tryWebFetch(company);
  if (wf) {
    inputTokens += wf.inputTokens;
    outputTokens += wf.outputTokens;
    const parsed = parseSignals(wf.text);
    if (parsed.length > 0 || wf.text.length > 150) {
      signals = parsed.map((p) =>
        makeSignal({
          categorie: "failliet_of_surseance",
          sterkte: p.sterkte,
          confidence: p.confidence,
          observatie: p.observatie,
          bewijs: p.bewijs,
          bron_url: SEARCH_URL(company.naam),
        }),
      );
      success = true;
      pathTaken = "web_fetch";
    }
  }

  if (!success) {
    try {
      const html = await tryPlaywright(company);
      if (html.length > 150) {
        const cls = await classifyText(company, html);
        inputTokens += cls.inputTokens;
        outputTokens += cls.outputTokens;
        signals = cls.signals;
        success = true;
        pathTaken = "playwright";
      }
    } catch (err) {
      await writeDebug(`04-playwright-error-${company.id}`, {
        error: errMessage(err),
      });
    }
  }

  return {
    success,
    durationMs: Date.now() - t0,
    hitCount: signals.length,
    signals,
    cost: {
      inputTokens,
      outputTokens,
      estimatedUsd: estimateCostUsd(inputTokens, outputTokens),
    },
    debug: { pathTaken, purpose: "uitsluit-filter" },
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
            toelichting: `Register-lookup werkt voor ${(rate * 100).toFixed(0)}% van bedrijven. ${hits} treffer(s) — gebruik als uitsluit-filter.`,
          };
        if (rate >= 0.7)
          return {
            verdict: "werkt_met_aanpassing",
            toelichting: `${(rate * 100).toFixed(0)}% werkt. SPA is JS-zwaar — Playwright-fallback levert meeste dekking.`,
          };
        if (rate >= 0.3)
          return {
            verdict: "fragiel",
            toelichting: "SPA-timing wisselend. Zou baat hebben bij langere waittimes of officieel data-product.",
          };
        return {
          verdict: "niet_werkbaar",
          toelichting: "Register onbereikbaar via beide paden.",
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
