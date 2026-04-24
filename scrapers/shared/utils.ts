import Anthropic from "@anthropic-ai/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CompanyResult,
  ScraperReport,
  ScraperVerdict,
  Signaal,
  SignaalCategorie,
  TestCompany,
} from "./types.ts";
import { CLUSTER_FOR } from "./types.ts";

// ---------- env & paths ----------------------------------------------------

export const SCRAPERS_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const OUTPUT_DIR = resolve(SCRAPERS_ROOT, "output");
export const DEBUG_DIR = resolve(OUTPUT_DIR, "debug");

export function isDryRun(): boolean {
  return process.env.DRY_RUN === "true" || process.env.DRY_RUN === "1";
}

export function getModel(): string {
  return process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
}

// ---------- Anthropic client ----------------------------------------------

let cachedClient: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY ontbreekt. Zet hem in je .env file (zie .env.example).",
    );
  }
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

// Sonnet 4.6 list price at time of writing: $3 / MTok input, $15 / MTok output.
const INPUT_USD_PER_TOKEN = 3 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 15 / 1_000_000;

export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return inputTokens * INPUT_USD_PER_TOKEN + outputTokens * OUTPUT_USD_PER_TOKEN;
}

// ---------- retry & timeout -----------------------------------------------

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  label?: string;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 1_000, label = "op" } = opts;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(
        `  [retry ${attempt}/${maxAttempts - 1}] ${label} faalde: ${errMessage(err)} — wacht ${delay}ms`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label = "op"): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout na ${ms}ms`)), ms),
    ),
  ]);
}

export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// ---------- HTTP helpers --------------------------------------------------

// Realistic UA so scrapers don't trip bot-rules on public portals.
export const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

export async function httpGet(
  url: string,
  init: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ status: number; body: string; headers: Headers }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), init.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept: "*/*",
        ...init.headers,
      },
      signal: controller.signal,
    });
    const body = await res.text();
    return { status: res.status, body, headers: res.headers };
  } finally {
    clearTimeout(t);
  }
}

// ---------- signal helpers ------------------------------------------------

// Normalises a raw classification result into a Signaal shape, forcing the
// cluster field to the correct value. Scrapers should never set `cluster`
// directly — it flows from the category via CLUSTER_FOR.
export function makeSignal(input: {
  categorie: SignaalCategorie;
  sterkte: number;
  confidence: number;
  observatie: string;
  bewijs?: string[];
  bron_url?: string;
}): Signaal {
  return {
    categorie: input.categorie,
    cluster: CLUSTER_FOR[input.categorie],
    sterkte: clamp(input.sterkte, 0, 100),
    confidence: clamp(input.confidence, 0, 100),
    observatie: input.observatie,
    bewijs: input.bewijs,
    bron_url: input.bron_url,
  };
}

export function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

// ---------- report I/O ----------------------------------------------------

export function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function writeReport(
  scraperName: string,
  report: ScraperReport,
): Promise<string> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const filename = `${scraperName}-${timestamp()}.json`;
  const path = resolve(OUTPUT_DIR, filename);
  await writeFile(path, JSON.stringify(report, null, 2), "utf8");
  return path;
}

export async function writeDebug(
  name: string,
  payload: unknown,
): Promise<string> {
  await mkdir(DEBUG_DIR, { recursive: true });
  const path = resolve(DEBUG_DIR, `${name}-${timestamp()}.json`);
  await writeFile(
    path,
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
    "utf8",
  );
  return path;
}

// ---------- verdict helpers -----------------------------------------------

export function deriveVerdict(
  results: CompanyResult[],
  opts: {
    minSuccessRateProd?: number;
    minSuccessRateWithTweak?: number;
    minSuccessRateFragile?: number;
  } = {},
): { verdict: ScraperVerdict; rate: number } {
  const {
    minSuccessRateProd = 0.9,
    minSuccessRateWithTweak = 0.7,
    minSuccessRateFragile = 0.3,
  } = opts;
  const attempted = results.length;
  if (attempted === 0) return { verdict: "niet_werkbaar", rate: 0 };
  const ok = results.filter((r) => r.success).length;
  const rate = ok / attempted;
  if (rate >= minSuccessRateProd) return { verdict: "productie_klaar", rate };
  if (rate >= minSuccessRateWithTweak)
    return { verdict: "werkt_met_aanpassing", rate };
  if (rate >= minSuccessRateFragile) return { verdict: "fragiel", rate };
  return { verdict: "niet_werkbaar", rate };
}

// ---------- runner harness ------------------------------------------------

export type ScraperRunner = {
  scraperName: string;
  handle: (company: TestCompany) => Promise<Omit<CompanyResult, "company">>;
  limitForDryRun?: number; // default 3
  deriveVerdict?: (results: CompanyResult[]) => {
    verdict: ScraperVerdict;
    toelichting: string;
  };
};

export async function runScraperOverCompanies(
  runner: ScraperRunner,
  companies: TestCompany[],
): Promise<ScraperReport> {
  const dry = isDryRun();
  const limit = runner.limitForDryRun ?? 3;
  const workList = dry ? companies.slice(0, limit) : companies;

  console.log(
    `\n=== ${runner.scraperName} — ${workList.length} bedrijf/bedrijven${dry ? " (DRY_RUN)" : ""} ===\n`,
  );

  const startedAt = new Date().toISOString();
  const results: CompanyResult[] = [];

  for (const company of workList) {
    const t0 = Date.now();
    console.log(`→ ${company.naam} (${company.id})`);
    try {
      const outcome = await runner.handle(company);
      const fullResult: CompanyResult = { company, ...outcome };
      results.push(fullResult);
      console.log(
        `  ✓ ${fullResult.success ? "OK" : "FAIL"} — ${fullResult.hitCount} hits, ${fullResult.signals.length} signalen, €${fullResult.cost.estimatedUsd.toFixed(4)}, ${fullResult.durationMs}ms`,
      );
    } catch (err) {
      const msg = errMessage(err);
      results.push({
        company,
        success: false,
        durationMs: Date.now() - t0,
        hitCount: 0,
        signals: [],
        cost: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
        error: msg,
      });
      console.log(`  ✗ onverwachte fout: ${msg}`);
    }
  }

  const finishedAt = new Date().toISOString();
  const totalSignals = results.reduce((acc, r) => acc + r.signals.length, 0);
  const companiesSucceeded = results.filter((r) => r.success).length;

  const totalCost = results.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.cost.inputTokens,
      outputTokens: acc.outputTokens + r.cost.outputTokens,
      estimatedUsd: acc.estimatedUsd + r.cost.estimatedUsd,
    }),
    { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
  );

  const derived = runner.deriveVerdict
    ? runner.deriveVerdict(results)
    : (() => {
        const { verdict, rate } = deriveVerdict(results);
        return {
          verdict,
          toelichting: `Slagingspercentage ${(rate * 100).toFixed(0)}% over ${results.length} bedrijven.`,
        };
      })();

  const report: ScraperReport = {
    scraper: runner.scraperName,
    startedAt,
    finishedAt,
    companiesAttempted: results.length,
    companiesSucceeded,
    totalSignals,
    verdict: derived.verdict,
    verdict_toelichting: derived.toelichting,
    totalCost,
    results,
  };

  const path = await writeReport(runner.scraperName, report);
  console.log(
    `\nRapport weggeschreven: ${path}\nVerdict: ${report.verdict} — ${report.verdict_toelichting}\nTotale kosten: €${report.totalCost.estimatedUsd.toFixed(4)}\n`,
  );
  return report;
}

// ---------- Claude JSON helper --------------------------------------------

// Extracts the first JSON block from a Claude text response. Models sometimes
// wrap output in ```json … ``` fences or add prose around the JSON — this
// trims both cases.
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const startArr = candidate.indexOf("[");
  const first =
    startArr !== -1 && (startArr < start || start === -1) ? startArr : start;
  if (first === -1) throw new Error("Geen JSON gevonden in Claude-output");
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (end === -1 || end < first) throw new Error("Ongeldige JSON-structuur");
  const raw = candidate.slice(first, end + 1);
  return JSON.parse(raw) as T;
}

// Convenience: turn a TextBlock-like array into a single string. Accepts
// both the stable ContentBlock and the beta variant (web_fetch/web_search
// responses come back typed as BetaContentBlock[]), which is why we take
// a structural union rather than importing the exact class.
type AnyTextBlock = { type: string; text?: string };

export function textOf(content: readonly AnyTextBlock[]): string {
  return content
    .filter((b): b is AnyTextBlock & { text: string } =>
      b.type === "text" && typeof b.text === "string",
    )
    .map((b) => b.text)
    .join("\n");
}
