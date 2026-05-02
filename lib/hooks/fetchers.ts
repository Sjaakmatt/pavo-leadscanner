// Gedeelde fetchers per tab — gebruikt door zowel page-componenten
// (via useCachedFetch) als door HeaderNav (voor prefetch-on-hover).
//
// Belangrijk: prefetch en page MOETEN exact dezelfde fetcher
// gebruiken, anders eindigt er een raw API-response in de cache die
// de page niet kan unwrappen, en zie je "leeg" terwijl er data is.

export type SearchRow = {
  id: string;
  filters: Record<string, unknown>;
  status: string;
  total_candidates: number | null;
  total_leads_returned: number | null;
  duration_ms: number | null;
  total_cost_usd: number | null;
  created_at: string;
  completed_at: string | null;
};

export type StatusRow = {
  kvk: string;
  owner: string;
  status: string;
  reden: string | null;
  notitie: string | null;
  updated_at: string;
  updated_by: string | null;
  companies: {
    naam: string | null;
    plaats: string | null;
    fte_klasse: string | null;
  } | null;
};

export type Job = {
  id: string;
  naam: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  total_leads: number | null;
  total_cost_usd: number | null;
  error_message: string | null;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  use_batch: boolean;
  filters: Record<string, unknown>;
  search_query_id: string | null;
};

export type FetchResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "error"; message: string };

async function safeJson<T>(
  res: Response,
  pluck: (b: unknown) => T,
  notFoundMsg = "Niet beschikbaar",
): Promise<FetchResult<T>> {
  if (res.status === 401 || res.status === 503) {
    return { kind: "error", message: notFoundMsg };
  }
  if (!res.ok) return { kind: "error", message: `Status ${res.status}` };
  const body = await res.json();
  return { kind: "ok", data: pluck(body) };
}

// === Searches (geschiedenis) ===
export const SEARCHES_KEY = "/api/searches";
export async function fetchSearches(): Promise<FetchResult<SearchRow[]>> {
  const res = await fetch(SEARCHES_KEY, { cache: "no-store" });
  return safeJson(
    res,
    (b) => (b as { searches: SearchRow[] }).searches,
    "Niet beschikbaar — log in om je geschiedenis te zien.",
  );
}

// === Pipeline (lead-status) ===
export const PIPELINE_KEY = "/api/lead-status";
export async function fetchPipeline(): Promise<FetchResult<StatusRow[]>> {
  const res = await fetch(PIPELINE_KEY, { cache: "no-store" });
  return safeJson(
    res,
    (b) => (b as { statuses: StatusRow[] }).statuses,
    "Pipeline niet beschikbaar",
  );
}

// === Search-jobs ===
export const JOBS_KEY = "/api/search-jobs";
export async function fetchJobs(): Promise<FetchResult<Job[]>> {
  const res = await fetch(JOBS_KEY, { cache: "no-store" });
  return safeJson(
    res,
    (b) => (b as { jobs: Job[] }).jobs,
    "Niet beschikbaar",
  );
}

// Welke routes hebben een prefetch-able API? Gebruikt door HeaderNav
// om on-hover de cache te warmen. Pages die geen entry hebben krijgen
// alleen de Next-route prefetch.
export const PREFETCH_FETCHERS: Record<string, { key: string; fetcher: () => Promise<unknown> }> = {
  "/searches": { key: SEARCHES_KEY, fetcher: fetchSearches },
  "/pipeline": { key: PIPELINE_KEY, fetcher: fetchPipeline },
  "/search-jobs": { key: JOBS_KEY, fetcher: fetchJobs },
};
