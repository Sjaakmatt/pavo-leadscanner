// Playwright launcher die zowel lokaal als op Vercel werkt.
//
//   Lokaal (Mac/Linux dev): gebruikt de lokaal geïnstalleerde Chromium
//                            (via `playwright install chromium`).
//   Vercel (AWS Lambda):    gebruikt @sparticuz/chromium, een
//                            gecomprimeerde Chrome die binnen de
//                            250MB-function-size past.
//
// We detecteren lambda via `process.env.AWS_LAMBDA_FUNCTION_NAME` —
// Vercel zet die automatisch. Op een macbook is hij niet gezet en val
// je terug op playwright-core + je lokale Chrome-installatie.

import type { Browser, BrowserContext, Page } from "playwright-core";
import { chromium as playwrightChromium } from "playwright-core";

const isLambda =
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.VERCEL_ENV ||
  process.env.NODE_ENV === "production";

// Default UA voor MKB-sites die anti-bot rules hebben. We acteren als
// gewone Safari op macOS; veel restrictievere dan dat draait toch op
// andere detectie-lagen.
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

let cachedBrowser: Browser | null = null;

async function launchLambdaBrowser(): Promise<Browser> {
  const chromium = (await import("@sparticuz/chromium")).default;
  const executablePath = await chromium.executablePath();
  return playwrightChromium.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  });
}

async function launchLocalBrowser(): Promise<Browser> {
  return playwrightChromium.launch({ headless: true });
}

export async function getBrowser(): Promise<Browser> {
  if (cachedBrowser && cachedBrowser.isConnected()) return cachedBrowser;
  cachedBrowser = isLambda
    ? await launchLambdaBrowser()
    : await launchLocalBrowser();
  return cachedBrowser;
}

export async function closeBrowser(): Promise<void> {
  if (cachedBrowser) {
    try {
      await cachedBrowser.close();
    } catch {
      // Swallow — caller doesn't care if it's already gone.
    }
    cachedBrowser = null;
  }
}

// Convenience helper: doe één page-load en geef de tekst terug. Sluit
// pagina + context keurig af zodat we niet lekken bij parallelle calls.
export async function withPage<T>(
  fn: (page: Page, ctx: BrowserContext) => Promise<T>,
  opts: { userAgent?: string; locale?: string; timeoutMs?: number } = {},
): Promise<T> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent: opts.userAgent ?? BROWSER_UA,
    locale: opts.locale ?? "nl-NL",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(opts.timeoutMs ?? 30_000);
  try {
    return await fn(page, ctx);
  } finally {
    await ctx.close().catch(() => {});
  }
}

// Body-text extractor: haalt de zichtbare tekst op nadat we ruis
// (script/style/nav/footer) hebben verwijderd. Deze schone tekst wordt
// doorgegeven aan Claude voor classificatie — dat kost ~1k tokens ipv
// ~15k bij web_fetch, die de hele rauwe HTML als input stuurt.
export async function extractBodyText(
  page: Page,
  opts: { maxChars?: number } = {},
): Promise<string> {
  const max = opts.maxChars ?? 12_000;
  const text = await page
    .evaluate(() => {
      const doc = document.cloneNode(true) as Document;
      for (const sel of ["script", "style", "nav", "footer", "noscript", "svg", "iframe"]) {
        doc.querySelectorAll(sel).forEach((el) => el.remove());
      }
      return doc.body?.innerText ?? "";
    })
    .catch(() => "");
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, max)
    .trim();
}
