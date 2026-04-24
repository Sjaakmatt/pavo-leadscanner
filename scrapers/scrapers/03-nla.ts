// Scraper 3 — Nederlandse Arbeidsinspectie (NLA) open inspection results.
//
// Strategy (pattern B from the briefing):
//   1. Primary: Anthropic `web_fetch` tool queries the three NLA portals
//      (main inspection results + asbestovertredingen + seveso-plus).
//   2. Fallback: Playwright headless browser hits the main search URL.
//   3. Claude then classifies any hits against:
//        - arbo_boete_recent (cluster 1, sterkte 90+)
//        - arbeidsinspectie_stillegging (cluster 1, sterkte 95+)
//        - asbest_overtreding (cluster 1, sterkte 85+)
//
// Hit-rate is expected to be very low (<5%), but every hit is a very
// strong lead signal.

import { chromium } from "playwright";
import {
  allSearchNames,
  companyLabel,
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
  SignaalCategorie,
  TestCompany,
} from "../shared/types.ts";
import { TEST_COMPANIES } from "../shared/test-companies.ts";

const SCRAPER_NAME = "03-nla";

const PORTALS = {
  main: (q: string) =>
    `https://resultaten.nlarbeidsinspectie.nl/?q=${encodeURIComponent(q)}`,
  asbest: (q: string) =>
    `https://asbestovertredingen.nlarbeidsinspectie.nl/?q=${encodeURIComponent(q)}`,
  seveso: (q: string) =>
    `https://seveso-plus.nl/?q=${encodeURIComponent(q)}`,
};

const CLASSIFY_SYSTEM = `Je analyseert de openbare NLA-inspectieresultaten voor één bedrijf. Je output is UITSLUITEND een JSON-array van signaal-objecten.

Toegestane categorieën:
- arbo_boete_recent (cluster 1, sterkte 90+): boete wegens overtreding Arbowet in afgelopen 3 jaar.
- arbeidsinspectie_stillegging (cluster 1, sterkte 95+): bedrijf of locatie stilgelegd door NLA.
- asbest_overtreding (cluster 1, sterkte 85+): vermelding op asbestovertredingen-register.

Voor elk signaal:
{
  "categorie": "<categorie>",
  "sterkte": 0-100,
  "confidence": 0-100,
  "observatie": "korte Nederlandse uitleg, noem datum en type overtreding",
  "bewijs": ["citaat uit resultaat"]
}

Als het bedrijf NIET op de portals staat, antwoord met []. Verzin niets. Antwoord zonder markdown-fences.`;

async function tryWebFetch(company: TestCompany): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
} | null> {
  const client = getAnthropic();
  try {
    // Try the main portal for every search-name variant — the other two
    // registers are opened with the primary name (they cover zeldzame
    // gevallen die zelden op naam-varianten verschillen). Max-uses budget
    // schaalt mee.
    const names = allSearchNames(company);
    const mainUrls = names.map((n) => PORTALS.main(n));
    const allUrls = [...mainUrls, PORTALS.asbest(company.naam), PORTALS.seveso(company.naam)];
    const response = await withRetry(
      () =>
        withTimeout(
          client.beta.messages.create({
            model: getModel(),
            max_tokens: 2048,
            betas: ["web-fetch-2025-09-10"],
            tools: [
              {
                type: "web_fetch_20250910",
                name: "web_fetch",
                max_uses: Math.min(8, allUrls.length + 1),
              } as never,
            ],
            system: CLASSIFY_SYSTEM,
            messages: [
              {
                role: "user",
                content: `Zoek naar ${companyLabel(company)} op deze NLA-registers. Als de primaire naam niets oplevert, probeer de alternatieven:\n${allUrls.map((u) => `- ${u}`).join("\n")}\n\nClassificeer volgens de instructies.`,
              },
            ],
          }),
          45_000,
          "nla-webfetch",
        ),
      { maxAttempts: 2, label: "nla-webfetch" },
    );
    return {
      text: textOf(response.content),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch (err) {
    await writeDebug(`03-webfetch-error-${company.id}`, {
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
    const chunks: string[] = [];
    for (const term of allSearchNames(company)) {
      for (const [label, builder] of Object.entries(PORTALS)) {
        // The secundaire portals (asbest, seveso) we query only once on
        // the canonical name — they're low-hit sources and we'd triple
        // the browser-load budget for marginal gain.
        if (label !== "main" && term !== company.naam) continue;
        try {
          await page.goto(builder(term), {
            waitUntil: "domcontentloaded",
            timeout: 25_000,
          });
          await page.waitForTimeout(2_000);
          const text = await page.innerText("body").catch(() => "");
          chunks.push(`# portal:${label} zoekterm:"${term}"\n${text.slice(0, 6_000)}`);
        } catch (err) {
          chunks.push(
            `# portal:${label} zoekterm:"${term}"\n(fout: ${errMessage(err)})`,
          );
        }
      }
    }
    return chunks.join("\n\n");
  } finally {
    await browser.close();
  }
}

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
          max_tokens: 1024,
          system: CLASSIFY_SYSTEM,
          messages: [
            {
              role: "user",
              content: `Bedrijf: ${companyLabel(company)}\n\nInhoud NLA-portals:\n---\n${text.slice(0, 12_000)}\n---`,
            },
          ],
        }),
        30_000,
        "nla-classify",
      ),
    { maxAttempts: 2, label: "nla-classify" },
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
        bron_url: PORTALS.main(company.naam),
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
    if (parsed.length > 0 || wf.text.length > 200) {
      signals = parsed.map((p) =>
        makeSignal({
          categorie: p.categorie,
          sterkte: p.sterkte,
          confidence: p.confidence,
          observatie: p.observatie,
          bewijs: p.bewijs,
          bron_url: PORTALS.main(company.naam),
        }),
      );
      success = true;
      pathTaken = "web_fetch";
    }
  }

  if (!success) {
    try {
      const html = await tryPlaywright(company);
      if (html.length > 200) {
        const cls = await classifyText(company, html);
        inputTokens += cls.inputTokens;
        outputTokens += cls.outputTokens;
        signals = cls.signals;
        success = true;
        pathTaken = "playwright";
      }
    } catch (err) {
      await writeDebug(`03-playwright-error-${company.id}`, {
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
    debug: { pathTaken },
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
        const expectedHitRate = "< 5% hit-rate is normaal voor NLA — geen hits is geen falen.";
        if (rate >= 0.9)
          return {
            verdict: "productie_klaar",
            toelichting: `Portals ondervraagbaar voor ${(rate * 100).toFixed(0)}% van de bedrijven. ${hits} treffer(s). ${expectedHitRate}`,
          };
        if (rate >= 0.7)
          return {
            verdict: "werkt_met_aanpassing",
            toelichting: `Werkt voor ${(rate * 100).toFixed(0)}% maar portals zijn JS-heavy. Playwright-fallback zorgt voor dekking.`,
          };
        if (rate >= 0.3)
          return {
            verdict: "fragiel",
            toelichting: "Portals reageren wisselend — de DOM wijzigt regelmatig. Handhaving vergt monitoring.",
          };
        return {
          verdict: "niet_werkbaar",
          toelichting: "Beide paden falen — mogelijk rate-limiting of DOM-wijziging.",
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
