// Scraper 03 (productie) — Nederlandse Arbeidsinspectie. Playwright-first
// over drie portals, web_fetch fallback.

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

const BRON_TYPE = "nla";

const PORTALS = {
  main: (q: string) => `https://resultaten.nlarbeidsinspectie.nl/?q=${encodeURIComponent(q)}`,
  asbest: (q: string) => `https://asbestovertredingen.nlarbeidsinspectie.nl/?q=${encodeURIComponent(q)}`,
  seveso: (q: string) => `https://seveso-plus.nl/?q=${encodeURIComponent(q)}`,
};

const CLASSIFY_SYSTEM = `NLA-analist. Geef JSON-array met categorieën:
- arbo_boete_recent (cluster 1, sterkte 90+): boete Arbowet afgelopen 3 jaar.
- arbeidsinspectie_stillegging (cluster 1, sterkte 95+): bedrijf stilgelegd door NLA.
- asbest_overtreding (cluster 1, sterkte 85+): vermelding asbestregister.
Schema: [{"categorie":"...","sterkte":0-100,"confidence":0-100,"observatie":"NL","bewijs":["..."]}]. Leeg [] bij niks.`;

type RawSignal = {
  categorie: string;
  sterkte: number;
  confidence: number;
  observatie: string;
  bewijs?: string[];
};

async function playwrightPath(company: CompanyForScraper): Promise<string | null> {
  try {
    return await withPage(async (page) => {
      const chunks: string[] = [];
      const names = [company.naam, ...company.zoeknamen].slice(0, 3);
      for (const term of names) {
        for (const [label, builder] of Object.entries(PORTALS)) {
          if (label !== "main" && term !== company.naam) continue;
          try {
            await page.goto(builder(term), { waitUntil: "domcontentloaded", timeout: 20_000 });
            await page.waitForTimeout(1_500);
            const text = await extractBodyText(page, { maxChars: 4_000 });
            chunks.push(`# ${label} "${term}"\n${text}`);
          } catch (err) {
            chunks.push(`# ${label} "${term}"\n(fout: ${String(err)})`);
          }
        }
      }
      return chunks.join("\n\n");
    });
  } catch {
    return null;
  }
}

async function webFetchFallback(company: CompanyForScraper): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
} | null> {
  try {
    const res = await withTimeout(
      anthropic().beta.messages.create({
        model: scraperModel(),
        max_tokens: 1500,
        betas: ["web-fetch-2025-09-10"],
        tools: [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 4 } as never],
        system: CLASSIFY_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Zoek ${company.naam} op:\n- ${PORTALS.main(company.naam)}\n- ${PORTALS.asbest(company.naam)}\n- ${PORTALS.seveso(company.naam)}`,
          },
        ],
      }),
      45_000,
      "nla-webfetch",
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
    const j = extractJson<RawSignal[] | { signalen: RawSignal[] }>(raw);
    const arr = Array.isArray(j) ? j : Array.isArray(j?.signalen) ? j.signalen : [];
    return arr.map((p) => makeSignal({ ...p, bron_url: bronUrl }, BRON_TYPE));
  } catch {
    return [];
  }
}

export async function runNlaScraper(company: CompanyForScraper): Promise<ScraperRunResult> {
  const t0 = Date.now();
  const bronUrl = PORTALS.main(company.naam);

  const pwText = await playwrightPath(company);
  if (pwText && pwText.length > 200) {
    const res = await anthropic().messages.create({
      model: scraperModel(),
      max_tokens: 1024,
      system: CLASSIFY_SYSTEM,
      messages: [
        { role: "user", content: `Bedrijf: ${company.naam}\n\n${pwText.slice(0, 10_000)}` },
      ],
    });
    const signals = parseSignals(textOfContent(res.content), bronUrl);
    return {
      signals,
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
