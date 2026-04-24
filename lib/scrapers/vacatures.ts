// Scraper 07 (productie) — vacature-aggregate. Eigen site (Playwright
// + JSON-LD) + werk.nl + NVB + SerpAPI indien key gezet.

import { XMLParser } from "fast-xml-parser";
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

const BRON_TYPE = "vacatures";

type Posting = {
  source: string;
  title: string;
  company?: string;
  location?: string;
  datePosted?: string;
  employmentType?: string;
  url?: string;
  snippet?: string;
};

const WERK_NL = (q: string) =>
  `https://www.werk.nl/werkzoekenden/vacatures/?trefwoord=${encodeURIComponent(q)}`;
const NVB = (q: string) =>
  `https://www.nationalevacaturebank.nl/vacature/zoeken?trefwoord=${encodeURIComponent(q)}`;

const xml = new XMLParser({ ignoreAttributes: false });

const CLASSIFY_SYSTEM = `PAVO vacature-analist. JSON-array signalen:
- veel_open_vacatures (cluster 2, 5+ actief), langlopende_vacatures (cluster 2, >60d), herposte_vacatures (cluster 2, dup/cross-source), hiring_manager_actief (cluster 2), recruiter_overload (cluster 2).
Schema: [{"categorie":"...","sterkte":0-100,"confidence":0-100,"observatie":"NL + kerncijfers","bewijs":["citaat"]}]. Leeg [] bij niks.`;

// ---------- JSON-LD JobPosting op eigen site -----------------------------

function parseJsonLdPostings(html: string, baseUrl: string): Posting[] {
  const out: Posting[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const data = JSON.parse(m[1].trim());
      const walk = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        const obj = node as Record<string, unknown>;
        const t = obj["@type"];
        const tStr = Array.isArray(t) ? t.join(",") : typeof t === "string" ? t : "";
        if (tStr.includes("JobPosting") && typeof obj.title === "string") {
          out.push({
            source: "eigen-site",
            title: obj.title,
            company: typeof obj.hiringOrganization === "object"
              ? (obj.hiringOrganization as Record<string, unknown>)?.name as string | undefined
              : typeof obj.hiringOrganization === "string" ? obj.hiringOrganization : undefined,
            location: typeof obj.jobLocation === "string" ? obj.jobLocation : undefined,
            datePosted: typeof obj.datePosted === "string" ? obj.datePosted : undefined,
            employmentType: typeof obj.employmentType === "string" ? obj.employmentType : undefined,
            url: typeof obj.url === "string" ? obj.url : baseUrl,
          });
        }
        if (Array.isArray(node)) node.forEach(walk);
        if (Array.isArray(obj["@graph"])) (obj["@graph"] as unknown[]).forEach(walk);
      };
      walk(data);
    } catch {
      // malformed block — skip
    }
  }
  return out;
}

async function fetchEigenSite(company: CompanyForScraper): Promise<Posting[]> {
  if (!company.websiteUrl) return [];
  const paths = ["/", "/vacatures", "/werken-bij", "/werkenbij", "/jobs", "/careers"];
  const out: Posting[] = [];
  for (const p of paths) {
    try {
      const u = new URL(p, company.websiteUrl).toString();
      const res = await fetch(u, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const html = await res.text();
      out.push(...parseJsonLdPostings(html, u));
      if (out.length >= 20) break;
    } catch {
      // skip broken paths
    }
  }
  return out;
}

// ---------- werk.nl + NVB via Playwright ---------------------------------

async function fetchBoardPage(url: string): Promise<string> {
  try {
    return await withPage(async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
      await page.waitForTimeout(1_500);
      return extractBodyText(page, { maxChars: 5_000 });
    });
  } catch {
    return "";
  }
}

async function extractBoardPostings(
  company: CompanyForScraper,
  source: string,
  text: string,
): Promise<{ postings: Posting[]; inputTokens: number; outputTokens: number }> {
  if (!text || text.length < 200) return { postings: [], inputTokens: 0, outputTokens: 0 };
  const res = await anthropic().messages.create({
    model: scraperModel(),
    max_tokens: 1500,
    system: `Je extraheert vacatures uit een zoekresultaat-pagina. JSON-array: [{"title":"","company":"","location":"","datePosted":"","employmentType":"","url":"","snippet":""}]. Alleen vacatures van het opgegeven bedrijf. Leeg [] bij niks.`,
    messages: [
      { role: "user", content: `Bedrijf: ${company.naam}\nBron: ${source}\n\n${text}` },
    ],
  });
  let postings: Posting[] = [];
  try {
    const j = extractJson<Posting[] | { vacatures: Posting[] }>(textOfContent(res.content));
    postings = Array.isArray(j) ? j : Array.isArray(j?.vacatures) ? j.vacatures : [];
  } catch {
    // swallow
  }
  return {
    postings: postings.map((p) => ({ ...p, source })),
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}

// ---------- SerpAPI ------------------------------------------------------

async function fetchSerpApi(company: CompanyForScraper): Promise<Posting[]> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];
  const url = `https://serpapi.com/search.json?engine=google_jobs&q=${encodeURIComponent(`"${company.naam}"`)}&location=Netherlands&hl=nl&api_key=${key}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { jobs_results?: Array<{ title?: string; company_name?: string; location?: string; description?: string; detected_extensions?: { posted_at?: string; schedule_type?: string } }> };
    return (data.jobs_results ?? []).map((j): Posting => ({
      source: "serpapi",
      title: j.title ?? "",
      company: j.company_name,
      location: j.location,
      datePosted: j.detected_extensions?.posted_at,
      employmentType: j.detected_extensions?.schedule_type,
      snippet: j.description?.slice(0, 300),
    }));
  } catch {
    return [];
  }
}

// ---------- main --------------------------------------------------------

export async function runVacaturesScraper(company: CompanyForScraper): Promise<ScraperRunResult> {
  const t0 = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;

  const [eigen, werkText, nvbText, serp] = await Promise.all([
    fetchEigenSite(company),
    fetchBoardPage(WERK_NL(company.naam)),
    fetchBoardPage(NVB(company.naam)),
    fetchSerpApi(company),
  ]);
  const werk = await extractBoardPostings(company, "werk.nl", werkText);
  const nvb = await extractBoardPostings(company, "nvb", nvbText);
  inputTokens += werk.inputTokens + nvb.inputTokens;
  outputTokens += werk.outputTokens + nvb.outputTokens;

  const all = [...eigen, ...werk.postings, ...nvb.postings, ...serp];
  // Dedup op genormaliseerde titel + bedrijfsnaam
  const seen = new Map<string, Posting>();
  for (const p of all) {
    const key = `${p.title.toLowerCase().replace(/\s+/g, " ").trim()}|${(p.company ?? "").toLowerCase().slice(0, 30)}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  const deduped = [...seen.values()];
  if (deduped.length === 0) {
    return {
      signals: [],
      method: "playwright",
      success: true,
      durationMs: Date.now() - t0,
      cost: { inputTokens, outputTokens, usd: estimateUsd(inputTokens, outputTokens) },
      debug: { reason: "geen vacatures" },
    };
  }

  const formatted = deduped
    .slice(0, 30)
    .map((p, i) => `${i + 1}. [${p.source}] ${p.title} · ${p.company ?? "?"} · ${p.location ?? ""} · gepost: ${p.datePosted ?? "?"}`)
    .join("\n");
  const res = await anthropic().messages.create({
    model: scraperModel(),
    max_tokens: 1200,
    system: CLASSIFY_SYSTEM,
    messages: [{ role: "user", content: `Bedrijf: ${company.naam}\nTotaal vacatures (dedup): ${deduped.length}\n\n${formatted}` }],
  });
  inputTokens += res.usage.input_tokens;
  outputTokens += res.usage.output_tokens;

  let parsed: Array<{ categorie: string; sterkte: number; confidence: number; observatie: string; bewijs?: string[] }> = [];
  try {
    const j = extractJson<typeof parsed | { signalen: typeof parsed }>(textOfContent(res.content));
    parsed = Array.isArray(j) ? j : Array.isArray(j?.signalen) ? j.signalen : [];
  } catch {
    // fine
  }
  const signals: ScraperSignal[] = parsed.map((p) => makeSignal({ ...p, bron_url: company.websiteUrl }, BRON_TYPE));
  return {
    signals,
    method: "playwright",
    success: true,
    durationMs: Date.now() - t0,
    cost: { inputTokens, outputTokens, usd: estimateUsd(inputTokens, outputTokens) },
    debug: { totalPostings: deduped.length, perSource: { eigen: eigen.length, werk: werk.postings.length, nvb: nvb.postings.length, serpapi: serp.length } },
  };
}
