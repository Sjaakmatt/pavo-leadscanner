// Scraper 01 (productie) — bedrijfswebsite HR-fingerprint, Playwright-first.
//
// Flow:
//   1. Playwright laadt homepage + relevante sub-pagina's (team, werken-bij, etc.)
//   2. Body-tekst extractie (schoon, geen script/style/nav) via JS-eval
//   3. Claude Haiku classificeert die schone tekst (~1k input tokens)
//   4. Alleen bij Playwright-fout of <500 chars: web_fetch fallback
//
// Verwachte kostenprofiel: ~$0.005 per bedrijf via Playwright-pad,
// ~$0.065 via fallback. Target: 85%+ via Playwright.

import type { Page } from "playwright-core";
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

const BRON_TYPE = "website";

const CANDIDATE_PATHS = [
  "/", "/team", "/over-ons", "/over", "/about",
  "/werken-bij", "/werkenbij", "/vacatures", "/jobs", "/careers",
  "/organisatie", "/medewerkers",
];

const CLASSIFY_SYSTEM = `Je bent de HR-fingerprint analist van PAVO. Je krijgt schone tekst uit één of meer pagina's van een bedrijfswebsite en moet vaststellen welke HR-signalen zichtbaar zijn.

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
{"categorie": "...", "sterkte": 0-100, "confidence": 0-100, "observatie": "max 20 woorden NL", "bewijs": ["woordelijk citaat"]}

Alleen echte observaties. Lege lijst [] als niets. Antwoord als JSON-array (geen fences).`;

type RawSignal = {
  categorie: string;
  sterkte: number;
  confidence: number;
  observatie: string;
  bewijs?: string[];
};

async function classify(
  company: CompanyForScraper,
  pages: { url: string; text: string }[],
): Promise<{ signals: ScraperSignal[]; inputTokens: number; outputTokens: number }> {
  const payload = pages
    .map((p) => `### ${p.url}\n${p.text}`)
    .join("\n\n---\n\n");
  const res = await anthropic().messages.create({
    model: scraperModel(),
    max_tokens: 1500,
    system: CLASSIFY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Bedrijf: ${company.naam}\nURL: ${company.websiteUrl ?? "?"}\n\nSchone body-tekst per pagina:\n\n${payload.slice(0, 14_000)}`,
      },
    ],
  });
  let parsed: RawSignal[] = [];
  try {
    const j = extractJson<RawSignal[] | { signalen: RawSignal[] }>(textOfContent(res.content));
    parsed = Array.isArray(j) ? j : Array.isArray(j?.signalen) ? j.signalen : [];
  } catch {
    // Swallow — classifier output-drift shouldn't blow up the scraper.
  }
  return {
    signals: parsed.map((p) =>
      makeSignal(
        { ...p, bron_url: company.websiteUrl },
        BRON_TYPE,
      ),
    ),
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}

async function discoverLinks(page: Page, baseUrl: string): Promise<string[]> {
  const links = await page
    .$$eval("a", (as: Element[]) =>
      (as as HTMLAnchorElement[])
        .map((a) => ({ href: a.href, text: (a.innerText || "").toLowerCase() }))
        .filter((l) => !!l.href),
    )
    .catch(() => [] as { href: string; text: string }[]);
  const keywords = [
    "team", "over-ons", "over ons", "medewerkers", "organisatie",
    "vacatures", "werken-bij", "werken bij", "jobs", "careers",
  ];
  const picked = new Set<string>();
  for (const l of links) {
    if (keywords.some((k) => l.text.includes(k) || l.href.toLowerCase().includes(k))) {
      try {
        const abs = new URL(l.href, baseUrl).toString();
        // Same-origin only — we don't follow external links.
        if (new URL(abs).host === new URL(baseUrl).host) picked.add(abs);
      } catch {
        // Invalid href — skip.
      }
    }
    if (picked.size >= 4) break;
  }
  return [...picked];
}

async function playwrightPath(
  company: CompanyForScraper,
): Promise<{ pages: { url: string; text: string }[]; totalChars: number } | null> {
  if (!company.websiteUrl) return null;
  try {
    return await withPage(async (page) => {
      const pages: { url: string; text: string }[] = [];
      const base = company.websiteUrl!;
      try {
        await page.goto(base, { waitUntil: "domcontentloaded", timeout: 25_000 });
      } catch {
        return { pages: [], totalChars: 0 };
      }
      const homeText = await extractBodyText(page, { maxChars: 6_000 });
      pages.push({ url: base, text: homeText });

      const subUrls = await discoverLinks(page, base);
      // Probe fixed candidate paths as backup when discovery turns up empty.
      if (subUrls.length === 0) {
        for (const p of CANDIDATE_PATHS.slice(1, 4)) {
          try {
            subUrls.push(new URL(p, base).toString());
          } catch {
            // invalid — skip
          }
        }
      }
      for (const sub of subUrls.slice(0, 3)) {
        try {
          await page.goto(sub, { waitUntil: "domcontentloaded", timeout: 15_000 });
          const t = await extractBodyText(page, { maxChars: 4_000 });
          if (t.length > 200) pages.push({ url: sub, text: t });
        } catch {
          // Skip broken sub-pages — we still have the homepage.
        }
      }
      const totalChars = pages.reduce((a, p) => a + p.text.length, 0);
      return { pages, totalChars };
    });
  } catch {
    return null;
  }
}

async function webFetchFallback(
  company: CompanyForScraper,
): Promise<{ signals: ScraperSignal[]; inputTokens: number; outputTokens: number } | null> {
  if (!company.websiteUrl) return null;
  const client = anthropic();
  try {
    const res = await withTimeout(
      client.beta.messages.create({
        model: scraperModel(),
        max_tokens: 2048,
        betas: ["web-fetch-2025-09-10"],
        tools: [
          { type: "web_fetch_20250910", name: "web_fetch", max_uses: 2 } as never,
        ],
        system: CLASSIFY_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Haal ${company.websiteUrl} + team/vacature-pagina op en classificeer.`,
          },
        ],
      }),
      45_000,
      "website-webfetch",
    );
    const text = textOfContent(res.content);
    let parsed: RawSignal[] = [];
    try {
      const j = extractJson<RawSignal[] | { signalen: RawSignal[] }>(text);
      parsed = Array.isArray(j) ? j : Array.isArray(j?.signalen) ? j.signalen : [];
    } catch {
      // fine — zero signals is a valid outcome
    }
    return {
      signals: parsed.map((p) =>
        makeSignal({ ...p, bron_url: company.websiteUrl }, BRON_TYPE),
      ),
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  } catch {
    return null;
  }
}

export async function runWebsiteScraper(
  company: CompanyForScraper,
): Promise<ScraperRunResult> {
  const t0 = Date.now();
  if (!company.websiteUrl) {
    return {
      signals: [],
      method: "playwright",
      success: false,
      error: "geen websiteUrl bekend",
      durationMs: Date.now() - t0,
      cost: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
  }

  // --- Playwright-first ---
  const pw = await playwrightPath(company);
  if (pw && pw.totalChars >= 500 && pw.pages.length > 0) {
    const { signals, inputTokens, outputTokens } = await classify(company, pw.pages);
    return {
      signals,
      method: "playwright",
      success: true,
      durationMs: Date.now() - t0,
      cost: {
        inputTokens,
        outputTokens,
        usd: estimateUsd(inputTokens, outputTokens),
      },
      debug: { pagesScraped: pw.pages.length, totalChars: pw.totalChars },
    };
  }

  // --- web_fetch fallback ---
  const wf = await webFetchFallback(company);
  if (wf) {
    return {
      signals: wf.signals,
      method: "web_fetch",
      success: true,
      durationMs: Date.now() - t0,
      cost: {
        inputTokens: wf.inputTokens,
        outputTokens: wf.outputTokens,
        usd: estimateUsd(wf.inputTokens, wf.outputTokens),
      },
      debug: { playwrightChars: pw?.totalChars ?? 0 },
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
