// Shared helpers for extracting vacancy data from the company's own site.
// Two complementary sources:
//   - JSON-LD JobPosting objects embedded via <script type="application/ld+json">
//     (Google for Jobs indexes these, so most serious employer sites ship them).
//   - sitemap.xml entries whose URL looks like a vacancy page, with their
//     <lastmod> timestamp — useful for "langlopende_vacatures" inference.
//
// Both paths are best-effort: we never throw, only collect errors so the
// calling scraper can log them without aborting.

import { httpGet } from "./utils.ts";

export type JobPosting = {
  title: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string;
  hiringOrganization?: string;
  jobLocation?: string;
  url?: string;
};

export type SitemapEntry = {
  url: string;
  lastmod?: string;
};

export type JobEnrichment = {
  jobPostings: JobPosting[];
  vacancyUrls: SitemapEntry[];
  errors: string[];
  pagesProbed: string[];
};

const CANDIDATE_VACANCY_PATHS = [
  "/vacatures",
  "/vacature",
  "/werken-bij",
  "/werkenbij",
  "/jobs",
  "/careers",
  "/carriere",
  "/kom-werken",
  "/werken",
];

const VACANCY_URL_PATTERNS = [
  /\/vacatures?\//i,
  /\/werken-bij\//i,
  /\/werkenbij\//i,
  /\/jobs?\//i,
  /\/careers?\//i,
  /\/carriere\//i,
];

const JSON_LD_REGEX =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

// Resolve any URL (absolute or relative) against a base, returning null if
// impossible. Used for safety around the rare broken-href.
function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function rootOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function extractTextish(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.name === "string") return o.name;
    if (typeof o.address === "string") return o.address;
    if (typeof o["@id"] === "string") return o["@id"];
  }
  return undefined;
}

function normaliseJobPosting(raw: unknown): JobPosting | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = r["@type"];
  const typeStr = Array.isArray(type) ? type.join(",") : typeof type === "string" ? type : "";
  if (!typeStr.includes("JobPosting")) return null;
  const title = typeof r.title === "string" ? r.title : undefined;
  if (!title) return null;
  return {
    title,
    datePosted: typeof r.datePosted === "string" ? r.datePosted : undefined,
    validThrough: typeof r.validThrough === "string" ? r.validThrough : undefined,
    employmentType:
      typeof r.employmentType === "string"
        ? r.employmentType
        : Array.isArray(r.employmentType)
          ? (r.employmentType as unknown[]).filter((x) => typeof x === "string").join(", ")
          : undefined,
    hiringOrganization: extractTextish(r.hiringOrganization),
    jobLocation: extractTextish(r.jobLocation),
    url: typeof r.url === "string" ? r.url : undefined,
  };
}

// JSON-LD can ship as a single object, an array of objects, or nested under
// `@graph`. This walker yields every plain object it encounters so the
// caller can pick JobPosting entries without worrying about shape.
function* walkJsonLd(node: unknown): Generator<unknown> {
  if (!node || typeof node !== "object") return;
  yield node;
  if (Array.isArray(node)) {
    for (const item of node) yield* walkJsonLd(item);
    return;
  }
  const obj = node as Record<string, unknown>;
  const graph = obj["@graph"];
  if (Array.isArray(graph)) for (const item of graph) yield* walkJsonLd(item);
}

export function parseJsonLdJobPostings(html: string): JobPosting[] {
  const out: JobPosting[] = [];
  const matches = html.matchAll(JSON_LD_REGEX);
  for (const m of matches) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      // Some sites embed slightly malformed JSON-LD (trailing commas,
      // unescaped newlines in strings). We JSON.parse opportunistically
      // and skip blocks that fail.
      const data = JSON.parse(raw);
      for (const node of walkJsonLd(data)) {
        const jp = normaliseJobPosting(node);
        if (jp) out.push(jp);
      }
    } catch {
      // Swallow — malformed block, not our problem.
    }
  }
  // Deduplicate on title+url because sites often embed the same posting in
  // both the list view and the detail view's JSON-LD.
  const seen = new Set<string>();
  return out.filter((jp) => {
    const key = `${jp.title.toLowerCase()}|${jp.url ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Minimal sitemap parser — handles both <urlset> and <sitemapindex>.
// When it sees a sitemap index it recursively fetches up to `maxChildren`
// child sitemaps (default 3) to stay within a sane time/cost budget.
export async function parseSitemapForVacancies(
  baseUrl: string,
  opts: { maxChildren?: number; timeoutMs?: number } = {},
): Promise<{ entries: SitemapEntry[]; errors: string[] }> {
  const root = rootOf(baseUrl);
  if (!root) return { entries: [], errors: ["kon root-URL niet bepalen"] };
  const maxChildren = opts.maxChildren ?? 3;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const errors: string[] = [];
  const entries: SitemapEntry[] = [];

  async function fetchOne(url: string): Promise<string | null> {
    try {
      const r = await httpGet(url, { timeoutMs });
      if (r.status !== 200 || !r.body) return null;
      return r.body;
    } catch (err) {
      errors.push(`sitemap fetch faalde ${url}: ${String(err)}`);
      return null;
    }
  }

  function extractTag(xml: string, tag: string): string[] {
    const re = new RegExp(`<${tag}>([^<]+)<\\/${tag}>`, "gi");
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
    return out;
  }

  // Pairs of <url>…<loc>…<lastmod>…</url> — simpler to parse as blocks.
  function extractUrlBlocks(xml: string): SitemapEntry[] {
    const blocks: SitemapEntry[] = [];
    const re = /<url>([\s\S]*?)<\/url>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const inner = m[1];
      const loc = inner.match(/<loc>([^<]+)<\/loc>/i)?.[1]?.trim();
      const lastmod = inner.match(/<lastmod>([^<]+)<\/lastmod>/i)?.[1]?.trim();
      if (loc) blocks.push({ url: loc, lastmod });
    }
    return blocks;
  }

  const primary = await fetchOne(`${root}/sitemap.xml`);
  if (!primary) return { entries, errors };

  if (/<sitemapindex/i.test(primary)) {
    const children = extractTag(primary, "loc").slice(0, maxChildren);
    for (const childUrl of children) {
      const body = await fetchOne(childUrl);
      if (!body) continue;
      entries.push(...extractUrlBlocks(body));
    }
  } else {
    entries.push(...extractUrlBlocks(primary));
  }

  // Keep only vacancy-like URLs.
  const vacancyEntries = entries.filter((e) =>
    VACANCY_URL_PATTERNS.some((rx) => rx.test(e.url)),
  );
  return { entries: vacancyEntries, errors };
}

export async function enrichWithJobPostings(
  baseUrl: string,
  opts: { timeoutMs?: number; maxJobPages?: number } = {},
): Promise<JobEnrichment> {
  const root = rootOf(baseUrl);
  const errors: string[] = [];
  const pagesProbed: string[] = [];
  const jobPostings: JobPosting[] = [];
  if (!root) {
    return { jobPostings: [], vacancyUrls: [], errors: ["kon root-URL niet bepalen"], pagesProbed: [] };
  }
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxJobPages = opts.maxJobPages ?? 3;

  // Probe the homepage first: many sites inline JobPosting JSON-LD on the
  // root (e.g. "featured vacancies" carousels).
  const candidates = [baseUrl, ...CANDIDATE_VACANCY_PATHS.map((p) => `${root}${p}`)];
  let successfulJobPages = 0;

  for (const url of candidates) {
    if (successfulJobPages >= maxJobPages) break;
    try {
      const r = await httpGet(url, { timeoutMs });
      pagesProbed.push(url);
      if (r.status !== 200 || !r.body || r.body.length < 100) continue;
      const found = parseJsonLdJobPostings(r.body);
      if (found.length > 0) {
        jobPostings.push(...found);
        successfulJobPages += 1;
      }
    } catch (err) {
      errors.push(`${url}: ${String(err)}`);
    }
  }

  const sitemap = await parseSitemapForVacancies(baseUrl);
  errors.push(...sitemap.errors);

  // Deduplicate postings across pages on title+url.
  const seen = new Set<string>();
  const dedupedPostings = jobPostings.filter((jp) => {
    const k = `${jp.title.toLowerCase()}|${jp.url ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Deduplicate sitemap entries on URL.
  const seenUrls = new Set<string>();
  const dedupedUrls = sitemap.entries.filter((e) => {
    if (seenUrls.has(e.url)) return false;
    seenUrls.add(e.url);
    return true;
  });

  // Keep only absolute URLs in the output — one less foot-gun downstream.
  const absUrls = dedupedUrls
    .map((e) => ({
      url: resolveUrl(e.url, root) ?? e.url,
      lastmod: e.lastmod,
    }))
    .filter((e) => /^https?:\/\//.test(e.url));

  return {
    jobPostings: dedupedPostings,
    vacancyUrls: absUrls,
    errors,
    pagesProbed,
  };
}

// Cheap "how long has this been up?" helper — used by both scraper 1 and 7
// to reason about langlopende_vacatures without needing Claude for trivial
// date math.
export function daysSince(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diff = Date.now() - t;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
