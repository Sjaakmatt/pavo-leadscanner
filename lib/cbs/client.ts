// CBS Open Data API client. Publiek (geen auth, geen rate-limit), data
// vernieuwt kwartaal, dus aggressief cachen scheelt RTT.
//
// Endpoint-pattern:
//   GET https://opendata.cbs.nl/ODataApi/odata/{tableId}/TypedDataSet?$filter=...&$select=...
//
// Caches per (tableId + filter-string) met 7-day TTL. Process-local;
// niet gedeeld over Vercel-instances, maar dat is OK — CBS is publiek
// en idempotent, een paar duplicate fetches per dag is geen probleem.

const BASE_URL = "https://opendata.cbs.nl/ODataApi/odata";
const CACHE_TTL_MS = 7 * 86_400_000;

interface CachedResponse<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CachedResponse<unknown>>();

interface ODataResponse<T> {
  value: T[];
  // OData kan paginaties geven via nextLink, voor onze top-N queries
  // negeren we die — CBS is geaggregeerd, één pagina is ruim genoeg.
  "odata.nextLink"?: string;
}

export interface CbsQuery {
  /** Bv. "80072NED" (ziekteverzuim) */
  tableId: string;
  /** OData $filter expression. Bv. "BedrijfstakkenSBI2008 eq '300006'" */
  filter?: string;
  /** OData $select. Bv. "Perioden,Ziekteverzuimpercentage_1" */
  select?: string;
  /** Sort. Bv. "Perioden desc" */
  orderby?: string;
  /** Cap rows. Default 12 (4 kwartalen × 3 jaar). */
  top?: number;
}

export async function fetchCbs<T>(query: CbsQuery): Promise<T[]> {
  const url = buildUrl(query);
  const cacheKey = url;

  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.data as T[];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(`[cbs] ${query.tableId} ${res.status} ${res.statusText}`);
      return [];
    }
    const json = (await res.json().catch(() => null)) as ODataResponse<T> | null;
    const data = json?.value ?? [];
    cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    console.warn(`[cbs] ${query.tableId} fetch faalde: ${String(err)}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function buildUrl(query: CbsQuery): string {
  const url = new URL(`${BASE_URL}/${query.tableId}/TypedDataSet`);
  if (query.filter) url.searchParams.set("$filter", query.filter);
  if (query.select) url.searchParams.set("$select", query.select);
  if (query.orderby) url.searchParams.set("$orderby", query.orderby);
  url.searchParams.set("$top", String(query.top ?? 12));
  url.searchParams.set("$format", "json");
  return url.toString();
}
