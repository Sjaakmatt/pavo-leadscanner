// Scraper 5 — Indeed.nl STRESS TEST.
//
// Explicit goal: prove that Indeed cannot be scraped reliably. We try up to
// 10 companies via Playwright, log each request's outcome in detail, and
// expect Cloudflare / reCAPTCHA blocks within 5-15 attempts. The verdict
// should come back `niet_werkbaar` with concrete evidence so we don't
// spend eng time on this route.
//
// DO NOT treat this scraper as a production input. It exists purely to
// document the failure mode.

import { chromium, type Browser } from "playwright";
import {
  errMessage,
  estimateCostUsd,
  runScraperOverCompanies,
  withTimeout,
  writeDebug,
} from "../shared/utils.ts";
import type { CompanyResult, TestCompany } from "../shared/types.ts";
import { TEST_COMPANIES } from "../shared/test-companies.ts";

const SCRAPER_NAME = "05-indeed";

// We only try at most 10 companies regardless of DRY_RUN — this scraper is
// an exploration, not a production feed. runScraperOverCompanies will still
// pick the DRY_RUN=true first 3 automatically.
const MAX_COMPANIES = 10;

const COMPANY_SLUG = (naam: string) =>
  naam
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const COMPANY_PAGE = (naam: string) =>
  `https://nl.indeed.com/cmp/${encodeURIComponent(COMPANY_SLUG(naam))}`;

// Shared browser across companies so the session cookies Indeed sets on the
// first request carry over — that's realistic for any scraper attempt and
// makes the block-detection data honest.
let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser) return sharedBrowser;
  sharedBrowser = await chromium.launch({ headless: true });
  return sharedBrowser;
}

type BlockDiagnosis = {
  status: number | null;
  hitCaptcha: boolean;
  hitCloudflare: boolean;
  redirectedToConsent: boolean;
  bodySnippet: string;
  url: string;
};

async function probeCompany(company: TestCompany): Promise<BlockDiagnosis> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    locale: "nl-NL",
  });
  const page = await ctx.newPage();
  try {
    const response = await withTimeout(
      page.goto(COMPANY_PAGE(company.naam), {
        waitUntil: "domcontentloaded",
        timeout: 25_000,
      }),
      30_000,
      "indeed-goto",
    );
    await page.waitForTimeout(2_000);
    const body = (await page.innerText("body").catch(() => "")).slice(0, 2_000);
    const lc = body.toLowerCase();
    const url = page.url();
    return {
      status: response?.status() ?? null,
      hitCaptcha:
        /captcha|recaptcha|are you a robot|verifieer dat je geen robot/.test(
          lc,
        ),
      hitCloudflare:
        /cloudflare|just a moment|checking your browser/.test(lc) ||
        (response?.status() ?? 0) === 403,
      redirectedToConsent: /consent|cookie/.test(url),
      bodySnippet: body,
      url,
    };
  } finally {
    await ctx.close();
  }
}

async function handle(
  company: TestCompany,
): Promise<Omit<CompanyResult, "company">> {
  const t0 = Date.now();
  try {
    const diag = await probeCompany(company);
    const blocked = diag.hitCaptcha || diag.hitCloudflare;
    await writeDebug(`05-indeed-${company.id}`, diag);
    return {
      // "success" here means "we got a determinate answer about whether the
      // page was blocked". The verdict below measures the actual blockage.
      success: true,
      durationMs: Date.now() - t0,
      hitCount: blocked ? 1 : 0,
      signals: [], // never produce signals — this is a stress-test only
      cost: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
      debug: {
        blocked,
        status: diag.status,
        hitCaptcha: diag.hitCaptcha,
        hitCloudflare: diag.hitCloudflare,
        redirectedToConsent: diag.redirectedToConsent,
        finalUrl: diag.url,
      },
    };
  } catch (err) {
    return {
      success: false,
      durationMs: Date.now() - t0,
      hitCount: 0,
      signals: [],
      cost: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
      error: errMessage(err),
      debug: { blocked: true, reason: "request-level error" },
    };
  }
}

async function main() {
  try {
    await runScraperOverCompanies(
      {
        scraperName: SCRAPER_NAME,
        handle,
        limitForDryRun: 3,
        deriveVerdict: (results) => {
          const attempted = results.length;
          const blocked = results.filter(
            (r) => (r.debug as { blocked?: boolean } | undefined)?.blocked,
          ).length;
          const blockRate = blocked / Math.max(attempted, 1);
          // Brief says: if more than 3/10 get captcha/block, verdict is niet_werkbaar.
          if (blockRate >= 0.3)
            return {
              verdict: "niet_werkbaar",
              toelichting: `${blocked}/${attempted} pogingen liepen vast op Cloudflare of captcha. Bevestigt dat Indeed niet te scrapen is zonder proxy-netwerk.`,
            };
          if (blockRate >= 0.1)
            return {
              verdict: "fragiel",
              toelichting: `${blocked}/${attempted} werden geblokt. Werkt op de korte termijn, zal snel breken.`,
            };
          return {
            verdict: "werkt_met_aanpassing",
            toelichting: `${blocked}/${attempted} geblokt. Marginaal stabiel — maar nog steeds risicovol voor productie.`,
          };
        },
      },
      TEST_COMPANIES.slice(0, MAX_COMPANIES),
    );
  } finally {
    if (sharedBrowser) {
      await sharedBrowser.close().catch(() => {});
      sharedBrowser = null;
    }
  }
}

main().catch(async (err) => {
  if (sharedBrowser) await sharedBrowser.close().catch(() => {});
  console.error("Fataal:", errMessage(err));
  process.exit(1);
});
