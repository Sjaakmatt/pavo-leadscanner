// Scraper 7 — vacancy aggregate.
//
// Combines five sources into a single per-company vacancy picture:
//
//   A. Company's own site (JSON-LD JobPostings + sitemap) via enrichWithJobPostings.
//      Gratis, gestructureerd, geen block-risico.
//   B. werk.nl (UWV) search page — via Anthropic web_fetch. UWV is a
//      government employer, scrape-friendly in practice.
//   C. Nationale Vacaturebank search page — also via web_fetch. Their DOM
//      shifts regularly; web_fetch handles that better than hand-written
//      HTML parsers.
//   D. SerpAPI Google Jobs (optional — needs SERPAPI_KEY). Premium pathway:
//      aggregate coverage across LinkedIn/Indeed/company sites through
//      Google's own Google-for-Jobs index. ~$0.005-0.015 per search
//      depending on plan.
//
// All sub-sources return VacancyPosting[]; we deduplicate by normalized
// title + company before handing the deduped list to Claude for signal
// classification (veel_open_vacatures, langlopende_vacatures,
// herposte_vacatures, hiring_manager_actief, seizoenspieken).
//
// Graceful degradation: any sub-source that fails (missing key, 4xx/5xx,
// timeout) logs a debug entry and the scraper continues with what it has.

import {
  allSearchNames,
  companyLabel,
  errMessage,
  estimateCostUsd,
  extractJson,
  getAnthropic,
  getModel,
  httpGet,
  makeSignal,
  runScraperOverCompanies,
  textOf,
  withRetry,
  withTimeout,
  writeDebug,
} from "../shared/utils.ts";
import {
  enrichWithJobPostings,
  daysSince,
} from "../shared/jobpostings.ts";
import type {
  CompanyResult,
  Signaal,
  SignaalCategorie,
  TestCompany,
} from "../shared/types.ts";
import { TEST_COMPANIES } from "../shared/test-companies.ts";

const SCRAPER_NAME = "07-vacatures";

// ---------- common vacancy-posting shape ---------------------------------

type VacancySource =
  | "eigen-site"
  | "werk.nl"
  | "nationale-vacaturebank"
  | "serpapi-google-jobs";

type VacancyPosting = {
  source: VacancySource;
  title: string;
  company?: string;
  location?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string;
  url?: string;
  snippet?: string;
  ageDays?: number | null;
};

type SourceResult = {
  source: VacancySource;
  postings: VacancyPosting[];
  error?: string;
  cost?: { inputTokens: number; outputTokens: number };
};

// ---------- A. eigen site -------------------------------------------------

async function fetchEigenSite(company: TestCompany): Promise<SourceResult> {
  try {
    const e = await enrichWithJobPostings(company.url);
    const postings: VacancyPosting[] = e.jobPostings.map((jp) => ({
      source: "eigen-site",
      title: jp.title,
      company: jp.hiringOrganization ?? company.naam,
      location: jp.jobLocation,
      datePosted: jp.datePosted,
      validThrough: jp.validThrough,
      employmentType: jp.employmentType,
      url: jp.url,
      ageDays: daysSince(jp.datePosted),
    }));
    return { source: "eigen-site", postings };
  } catch (err) {
    return { source: "eigen-site", postings: [], error: errMessage(err) };
  }
}

// ---------- B. werk.nl ----------------------------------------------------

const WERK_NL_SEARCH = (naam: string) =>
  `https://www.werk.nl/werkzoekenden/vacatures/?trefwoord=${encodeURIComponent(naam)}`;

// ---------- C. Nationale Vacaturebank ------------------------------------

const NVB_SEARCH = (naam: string) =>
  `https://www.nationalevacaturebank.nl/vacature/zoeken?trefwoord=${encodeURIComponent(naam)}`;

// ---------- web_fetch based extraction for B and C -----------------------

const EXTRACT_SYSTEM = `Je bent een vacature-extractor. Je krijgt één zoekresultaat-pagina en haalt daar álle vacatures uit die bij het opgegeven bedrijf horen.

Output UITSLUITEND een JSON-array. Voor elke vacature:
{
  "title": "functietitel",
  "company": "volledige bedrijfsnaam zoals op de pagina",
  "location": "plaats/regio",
  "datePosted": "ISO-datum indien zichtbaar, anders null",
  "employmentType": "fulltime/parttime/etc indien zichtbaar",
  "url": "directe link naar vacature",
  "snippet": "1-2 zinnen korte omschrijving"
}

Regels:
- ALLEEN vacatures waar het bedrijfsnaam-veld matcht met het opgegeven bedrijf. Homonieme hits (andere bedrijven met gelijke naam) negeren.
- Geen halve vacatures — verzin geen velden.
- Geen markdown-fences, puur JSON-array.
- Als er niks is, antwoord [].`;

async function fetchViaWebFetch(
  company: TestCompany,
  source: VacancySource,
  buildUrl: (naam: string) => string,
): Promise<SourceResult> {
  const client = getAnthropic();
  try {
    const names = allSearchNames(company);
    const urls = names.map((n) => buildUrl(n));
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
                max_uses: Math.min(6, urls.length + 1),
              } as never,
            ],
            system: EXTRACT_SYSTEM,
            messages: [
              {
                role: "user",
                content: `Zoek alle vacatures voor ${companyLabel(company)} op de onderstaande zoek-URLs. Probeer de varianten tot je vacatures vindt:\n${urls.map((u) => `- ${u}`).join("\n")}\n\nExtraheer de vacature-lijst. Bekende naam-varianten: ${names.join(", ")}.`,
              },
            ],
          }),
          60_000,
          `${source}-webfetch`,
        ),
      { maxAttempts: 2, label: `${source}-webfetch` },
    );
    const raw = textOf(response.content);
    const parsed = safeParsePostings(raw);
    return {
      source,
      postings: parsed.map((p) => ({
        ...p,
        source,
        ageDays: daysSince(p.datePosted),
      })),
      cost: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  } catch (err) {
    await writeDebug(`07-${source}-error-${company.id}`, {
      error: errMessage(err),
    });
    return { source, postings: [], error: errMessage(err) };
  }
}

function safeParsePostings(raw: string): VacancyPosting[] {
  try {
    const j = extractJson<VacancyPosting[] | { vacatures: VacancyPosting[] }>(raw);
    const arr = Array.isArray(j)
      ? j
      : Array.isArray(j?.vacatures)
        ? j.vacatures
        : [];
    return arr.filter(
      (p): p is VacancyPosting =>
        typeof p?.title === "string" && p.title.length > 2,
    );
  } catch {
    return [];
  }
}

// ---------- D. SerpAPI (Google Jobs) --------------------------------------

type SerpApiJobResult = {
  title?: string;
  company_name?: string;
  location?: string;
  description?: string;
  detected_extensions?: {
    posted_at?: string;
    schedule_type?: string;
  };
  apply_options?: Array<{ link?: string }>;
  share_link?: string;
};

type SerpApiResponse = {
  jobs_results?: SerpApiJobResult[];
  error?: string;
};

async function fetchSerpApi(company: TestCompany): Promise<SourceResult> {
  const key = process.env.SERPAPI_KEY;
  if (!key) {
    return {
      source: "serpapi-google-jobs",
      postings: [],
      error: "SERPAPI_KEY niet gezet — bron overgeslagen",
    };
  }
  const url = `https://serpapi.com/search.json?engine=google_jobs&q=${encodeURIComponent(`"${company.naam}"`)}&location=Netherlands&hl=nl&api_key=${key}`;
  try {
    const res = await withRetry(
      () => httpGet(url, { timeoutMs: 30_000 }),
      { maxAttempts: 3, label: "serpapi" },
    );
    if (res.status !== 200) {
      await writeDebug(`07-serpapi-status-${company.id}`, {
        status: res.status,
        body: res.body.slice(0, 1_000),
      });
      return {
        source: "serpapi-google-jobs",
        postings: [],
        error: `HTTP ${res.status}`,
      };
    }
    const data = JSON.parse(res.body) as SerpApiResponse;
    if (data.error) {
      return {
        source: "serpapi-google-jobs",
        postings: [],
        error: `SerpAPI fout: ${data.error}`,
      };
    }
    const postings = (data.jobs_results ?? []).map(
      (j): VacancyPosting => ({
        source: "serpapi-google-jobs",
        title: j.title ?? "(geen titel)",
        company: j.company_name,
        location: j.location,
        datePosted: approximatePostedDate(j.detected_extensions?.posted_at),
        employmentType: j.detected_extensions?.schedule_type,
        url: j.apply_options?.[0]?.link ?? j.share_link,
        snippet: j.description?.slice(0, 400),
        ageDays: parsePostedAtDays(j.detected_extensions?.posted_at),
      }),
    );
    // SerpAPI returns close matches, not exact. Filter on company_name
    // containing a significant token from the searched name.
    const needle = firstSignificantToken(company.naam);
    const filtered = needle
      ? postings.filter((p) =>
          (p.company ?? "").toLowerCase().includes(needle.toLowerCase()),
        )
      : postings;
    return { source: "serpapi-google-jobs", postings: filtered };
  } catch (err) {
    await writeDebug(`07-serpapi-error-${company.id}`, {
      error: errMessage(err),
    });
    return {
      source: "serpapi-google-jobs",
      postings: [],
      error: errMessage(err),
    };
  }
}

// "3 dagen geleden" / "2 days ago" → ISO date. Best-effort; falls back to
// leaving datePosted undefined when nothing parses.
function approximatePostedDate(postedAt: string | undefined): string | undefined {
  const days = parsePostedAtDays(postedAt);
  if (days === null) return undefined;
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function parsePostedAtDays(postedAt: string | undefined): number | null {
  if (!postedAt) return null;
  const m = postedAt.match(/(\d+)\s*(dag|day|week|maand|month)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit.startsWith("week")) return n * 7;
  if (unit.startsWith("maand") || unit.startsWith("month")) return n * 30;
  return n;
}

function firstSignificantToken(naam: string): string | null {
  const tokens = naam
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(
      (t) =>
        t.length > 3 &&
        !/^(b\.?v\.?|n\.?v\.?|holding|group|groep|van|de|der|den)$/i.test(t),
    );
  return tokens[0] ?? null;
}

// ---------- dedup + classification ---------------------------------------

function normaliseTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupePostings(all: VacancyPosting[]): VacancyPosting[] {
  const byKey = new Map<string, VacancyPosting>();
  for (const p of all) {
    const key = `${normaliseTitle(p.title)}|${(p.company ?? "").toLowerCase().slice(0, 40)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, p);
      continue;
    }
    // Merge: prefer the entry that has datePosted over one that doesn't,
    // and track multi-source hits in the snippet so Claude can detect
    // repost / cross-board patterns.
    const merged: VacancyPosting = {
      ...existing,
      datePosted: existing.datePosted ?? p.datePosted,
      url: existing.url ?? p.url,
      snippet: existing.snippet ?? p.snippet,
      ageDays: existing.ageDays ?? p.ageDays,
    };
    // Annotate the source so downstream can tell a cross-source duplicate.
    const sources = new Set<string>([existing.source, p.source]);
    (merged as VacancyPosting & { sources?: string[] }).sources = [...sources];
    byKey.set(key, merged);
  }
  return [...byKey.values()];
}

const CLASSIFY_SYSTEM = `Je bent PAVO's vacature-analist. Je krijgt een samengestelde lijst vacatures voor één bedrijf (bronnen: eigen site JSON-LD, werk.nl, Nationale Vacaturebank, SerpAPI/Google Jobs) en moet de PAVO-signalen afleiden.

Toegestane categorieën:
- veel_open_vacatures (cluster 2): 5+ actieve vacatures op dit moment.
- langlopende_vacatures (cluster 2): een of meer vacatures ouder dan 60 dagen — noem de oudste.
- herposte_vacatures (cluster 2): dezelfde titel verschijnt met verschillende datePosted óf dezelfde vacature op meerdere bronnen tegelijk.
- hiring_manager_actief (cluster 2): als een hiring-manager-naam in de snippets staat.
- recruiter_overload (cluster 2): veel verschillende rollen in korte tijd (bv. 10+ verschillende functies in 30 dagen).
- seizoenspieken (cluster 2): pieken rond vaste seizoenen (alleen claimen als het duidelijk zichtbaar is).

Voor elk signaal:
{
  "categorie": "<categorie>",
  "sterkte": 0-100,
  "confidence": 0-100,
  "observatie": "Nederlandse uitleg met kerncijfers (bv. '14 actieve vacatures, oudste 92 dagen')",
  "bewijs": ["concreet citaat of 'titel X gepost DD-MM-YYYY'"]
}

Regels:
- Alleen signalen met harde onderbouwing in de data — anders []. Verzin geen cijfers.
- Noem altijd totaal aantal vacatures en oudste leeftijd in de observatie als relevant.
- Antwoord zonder markdown-fences.`;

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

async function classifyVacancies(
  company: TestCompany,
  postings: VacancyPosting[],
): Promise<{ signals: Signaal[]; inputTokens: number; outputTokens: number }> {
  if (postings.length === 0) {
    return { signals: [], inputTokens: 0, outputTokens: 0 };
  }
  const client = getAnthropic();
  const formatted = postings
    .slice(0, 30)
    .map((p, i) => {
      const sources =
        (p as VacancyPosting & { sources?: string[] }).sources?.join(", ") ??
        p.source;
      const parts = [`${i + 1}. [${sources}] ${p.title}`];
      if (p.company) parts.push(`werkgever: ${p.company}`);
      if (p.location) parts.push(`locatie: ${p.location}`);
      if (p.datePosted)
        parts.push(`gepost: ${p.datePosted}${p.ageDays !== null && p.ageDays !== undefined ? ` (${p.ageDays}d)` : ""}`);
      if (p.employmentType) parts.push(p.employmentType);
      if (p.snippet) parts.push(`— ${p.snippet.slice(0, 200)}`);
      return parts.join(" · ");
    })
    .join("\n");

  const response = await withRetry(
    () =>
      withTimeout(
        client.messages.create({
          model: getModel(),
          max_tokens: 1500,
          system: CLASSIFY_SYSTEM,
          messages: [
            {
              role: "user",
              content: `Bedrijf: ${companyLabel(company)}\nTotaal vacatures (na dedup): ${postings.length}\n\n${formatted}`,
            },
          ],
        }),
        30_000,
        "vacatures-classify",
      ),
    { maxAttempts: 2, label: "vacatures-classify" },
  );
  const signals = parseSignals(textOf(response.content)).map((p) =>
    makeSignal({
      categorie: p.categorie,
      sterkte: p.sterkte,
      confidence: p.confidence,
      observatie: p.observatie,
      bewijs: p.bewijs,
      bron_url: company.url,
    }),
  );
  return {
    signals,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// ---------- main handle ---------------------------------------------------

async function handle(
  company: TestCompany,
): Promise<Omit<CompanyResult, "company">> {
  const t0 = Date.now();

  const [eigen, werkNl, nvb, serp] = await Promise.all([
    fetchEigenSite(company),
    fetchViaWebFetch(company, "werk.nl", WERK_NL_SEARCH),
    fetchViaWebFetch(company, "nationale-vacaturebank", NVB_SEARCH),
    fetchSerpApi(company),
  ]);

  const sourceResults = [eigen, werkNl, nvb, serp];

  let inputTokens = 0;
  let outputTokens = 0;
  for (const r of sourceResults) {
    if (r.cost) {
      inputTokens += r.cost.inputTokens;
      outputTokens += r.cost.outputTokens;
    }
  }

  const combined = sourceResults.flatMap((r) => r.postings);
  const deduped = dedupePostings(combined);

  const cls = await classifyVacancies(company, deduped);
  inputTokens += cls.inputTokens;
  outputTokens += cls.outputTokens;

  const sourcesWithHits = sourceResults.filter((r) => r.postings.length > 0).length;
  // "Success" = at least one source returned postings OR all sources
  // returned cleanly (0 vacatures is a valid negative observation).
  const allClean = sourceResults.every((r) => !r.error || r.error.includes("SERPAPI_KEY"));
  const success = sourcesWithHits > 0 || allClean;

  return {
    success,
    durationMs: Date.now() - t0,
    hitCount: deduped.length,
    signals: cls.signals,
    cost: {
      inputTokens,
      outputTokens,
      estimatedUsd: estimateCostUsd(inputTokens, outputTokens),
    },
    debug: {
      perSource: sourceResults.map((r) => ({
        source: r.source,
        postings: r.postings.length,
        error: r.error,
      })),
      dedupedCount: deduped.length,
      sourcesWithHits,
    },
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
        const bedrijvenMetVacatures = results.filter(
          (r) => r.hitCount > 0,
        ).length;
        const serpBeschikbaar = !!process.env.SERPAPI_KEY;
        const serpNoot = serpBeschikbaar
          ? "SerpAPI actief voor aggregate dekking."
          : "SerpAPI uit (geen key) — alleen eigen site + werk.nl + NVB.";
        if (rate >= 0.9)
          return {
            verdict: "productie_klaar",
            toelichting: `${(rate * 100).toFixed(0)}% slagingspercentage, ${bedrijvenMetVacatures}/${results.length} bedrijven met vacatures. ${serpNoot}`,
          };
        if (rate >= 0.7)
          return {
            verdict: "werkt_met_aanpassing",
            toelichting: `${(rate * 100).toFixed(0)}% werkt. Eén of twee bronnen leverden incidenteel niets — zie per-source debug. ${serpNoot}`,
          };
        if (rate >= 0.3)
          return {
            verdict: "fragiel",
            toelichting: `Slagingspercentage ${(rate * 100).toFixed(0)}% — meerdere bronnen onregelmatig. ${serpNoot}`,
          };
        return {
          verdict: "niet_werkbaar",
          toelichting: `Onder 30% succes over alle bronnen heen. ${serpNoot}`,
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
