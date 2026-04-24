// Scraper 1 — HR fingerprint of the company's own website.
//
// Strategy (pattern B from the briefing):
//   1. Primary: Anthropic `web_fetch` tool pulls the site in one Claude turn
//      and immediately classifies it against the PAVO signal vocabulary.
//   2. Fallback: Playwright (Chromium, headless) if web_fetch returns <500
//      meaningful characters or errors out. The HTML is then handed to a
//      plain Claude call for classification.
//
// We deliberately keep the prompt identical across both paths so signals
// stay comparable.

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
  SignaalCategorie,
  TestCompany,
} from "../shared/types.ts";
import { TEST_COMPANIES } from "../shared/test-companies.ts";

const SCRAPER_NAME = "01-website-fingerprint";

const CLASSIFY_SYSTEM = `Je bent de HR-fingerprint analist van PAVO. Je krijgt de inhoud van een bedrijfswebsite en moet vaststellen welke HR-signalen zichtbaar zijn.

Gebruik UITSLUITEND deze signaal-categorieën:
- geen_hr_rol_zichtbaar (cluster 1): geen HR/people/personeelszaken-rol op team-/contactpagina.
- snelle_groei (cluster 1): taal over sterke groei, nieuwe vestigingen, verdubbeling.
- veel_functies_geen_structuur (cluster 1): veel verschillende functies zonder duidelijke afdelings-/managementstructuur.
- internationale_uitbreiding (cluster 1): nieuwe buitenlandse vestigingen, export-focus.
- founder_run (cluster 3): DGA/oprichter zichtbaar als spil van het bedrijf.
- klein_team_in_groei (cluster 3): klein team, maar toon is expansief.
- veel_open_vacatures (cluster 2): vacature-pagina met 5+ openstaande posities.
- langlopende_vacatures (cluster 2): "nog steeds op zoek naar" of herpost-indicatie.

Voor ELKE gedetecteerde categorie geef je één signaal-object:
{
  "categorie": "<categorie>",
  "sterkte": 0-100,
  "confidence": 0-100,
  "observatie": "korte Nederlandse uitleg (max 20 woorden)",
  "bewijs": ["woordelijk citaat uit de website"]
}

Signaleer ALLEEN wat je echt in de content ziet. Verzin niets. Geef een lege lijst [] als je niets kunt vaststellen.

Antwoord als JSON-array (geen prose errom, geen markdown-fences).`;

async function tryWebFetch(company: TestCompany): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
} | null> {
  const client = getAnthropic();
  try {
    const response = await withRetry(
      () =>
        // The SDK does not yet ship typed definitions for the web_fetch beta
        // tool, so we cast the tool descriptor to `never` to bypass the
        // stricter tool-union type. This is the same workaround scraper 1
        // in the briefing uses; remove once Anthropic ships types.
        withTimeout(
          client.beta.messages.create({
            model: getModel(),
            max_tokens: 4096,
            betas: ["web-fetch-2025-09-10"],
            tools: [
              { type: "web_fetch_20250910", name: "web_fetch", max_uses: 2 } as never,
            ],
            system: CLASSIFY_SYSTEM,
            messages: [
              {
                role: "user",
                content: `Haal de homepage én de team/over-ons pagina op van ${company.url} en classificeer volgens de instructies. Focus op HR-signalen.`,
              },
            ],
          }),
          45_000,
          "web_fetch",
        ),
      { maxAttempts: 2, label: "web_fetch" },
    );
    const text = textOf(response.content);
    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch (err) {
    await writeDebug(`01-webfetch-error-${company.id}`, { error: errMessage(err) });
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
    await page.goto(company.url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const homeText = await page.innerText("body").catch(() => "");

    const teamLink = await page
      .$$eval("a", (nodes) => {
        const terms = [
          "team",
          "over-ons",
          "over ons",
          "medewerkers",
          "organisatie",
          "vacatures",
          "werken-bij",
          "werken bij",
        ];
        const anchors = nodes as HTMLAnchorElement[];
        const match = anchors.find((a) => {
          const t = (a.innerText || "").toLowerCase();
          return terms.some((term) => t.includes(term));
        });
        return match?.href ?? null;
      })
      .catch(() => null);

    let extraText = "";
    if (teamLink) {
      try {
        await page.goto(teamLink, {
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        });
        extraText = await page.innerText("body").catch(() => "");
      } catch {
        // Swallow — we still return what we have.
      }
    }

    return `# ${company.url}\n${homeText.slice(0, 8_000)}\n\n# ${teamLink ?? "(geen team-pagina)"}\n${extraText.slice(0, 6_000)}`;
  } finally {
    await browser.close();
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
          max_tokens: 2048,
          system: CLASSIFY_SYSTEM,
          messages: [
            {
              role: "user",
              content: `Bedrijf: ${company.naam}\nURL: ${company.url}\n\nWebsite-content:\n---\n${text.slice(0, 14_000)}\n---`,
            },
          ],
        }),
        30_000,
        "classify",
      ),
    { maxAttempts: 2, label: "classify" },
  );
  const raw = textOf(response.content);
  const parsed = safeParseSignals(raw);
  return {
    signals: parsed.map((p) =>
      makeSignal({
        categorie: p.categorie,
        sterkte: p.sterkte,
        confidence: p.confidence,
        observatie: p.observatie,
        bewijs: p.bewijs,
        bron_url: company.url,
      }),
    ),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

type RawSignal = {
  categorie: SignaalCategorie;
  sterkte: number;
  confidence: number;
  observatie: string;
  bewijs?: string[];
};

function safeParseSignals(raw: string): RawSignal[] {
  try {
    const parsed = extractJson<RawSignal[] | { signalen: RawSignal[] }>(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.signalen)) return parsed.signalen;
    return [];
  } catch {
    return [];
  }
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

  // Primary path — web_fetch (Claude does both the fetch and classification).
  const wf = await tryWebFetch(company);
  if (wf) {
    inputTokens += wf.inputTokens;
    outputTokens += wf.outputTokens;
    const parsed = safeParseSignals(wf.text);
    if (parsed.length > 0 || wf.text.length > 500) {
      signals = parsed.map((p) =>
        makeSignal({
          categorie: p.categorie,
          sterkte: p.sterkte,
          confidence: p.confidence,
          observatie: p.observatie,
          bewijs: p.bewijs,
          bron_url: company.url,
        }),
      );
      success = true;
      pathTaken = "web_fetch";
    }
  }

  // Fallback — Playwright + separate classification call.
  if (!success) {
    try {
      const html = await tryPlaywright(company);
      if (html.length > 500) {
        const cls = await classifyText(company, html);
        inputTokens += cls.inputTokens;
        outputTokens += cls.outputTokens;
        signals = cls.signals;
        success = true;
        pathTaken = "playwright";
      }
    } catch (err) {
      await writeDebug(`01-playwright-error-${company.id}`, {
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
        const webFetchWins = results.filter(
          (r) => (r.debug as { pathTaken?: string } | undefined)?.pathTaken === "web_fetch",
        ).length;
        if (rate >= 0.9)
          return {
            verdict: "productie_klaar",
            toelichting: `${(rate * 100).toFixed(0)}% slagingspercentage, waarvan ${webFetchWins} via web_fetch. Stabiele hybride scraper.`,
          };
        if (rate >= 0.7)
          return {
            verdict: "werkt_met_aanpassing",
            toelichting: `${(rate * 100).toFixed(0)}% slagingspercentage. Enkele sites vergen tuning (JS-renders, cookiewalls).`,
          };
        if (rate >= 0.3)
          return {
            verdict: "fragiel",
            toelichting: `Slechts ${(rate * 100).toFixed(0)}% slagingspercentage — fallback-pad werkt te vaak niet.`,
          };
        return {
          verdict: "niet_werkbaar",
          toelichting: "Minder dan 30% werkt — beide paden falen.",
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
