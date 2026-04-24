import { NextResponse } from "next/server";
import { currentMode } from "@/lib/lead-source";
import { tryGetSupabase } from "@/lib/supabase/client";

// Kosten-dashboard voor Sjaak: laatste 30 dagen aan scrape-kosten en
// search-kosten, plus een breakdown per scraper. Demo-modus geeft een
// leeg rapport — deze endpoint is puur voor prod-observability.

type ScrapeRunRow = {
  scraper: string;
  cost_usd: number | null;
  success: boolean | null;
  duration_ms: number | null;
  method: string | null;
  completed_at: string | null;
};

type SearchQueryRow = {
  total_candidates: number | null;
  total_scraped: number | null;
  total_leads_returned: number | null;
  total_cost_usd: number | null;
  duration_ms: number | null;
  created_at: string;
};

export async function GET() {
  const mode = currentMode();
  if (mode !== "prod") {
    return NextResponse.json({
      mode,
      message: "Kosten-dashboard is alleen relevant in prod-mode.",
      totals: { scrape_cost_usd: 0, search_cost_usd: 0, searches: 0 },
      per_scraper: [],
      recent_searches: [],
    });
  }

  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json(
      {
        mode,
        error:
          "Supabase niet geconfigureerd — kan geen kosten ophalen. Vul de NEXT_PUBLIC_SUPABASE_* + SUPABASE_SERVICE_ROLE_KEY in.",
      },
      { status: 503 },
    );
  }

  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [scrapeRunsRes, queriesRes] = await Promise.all([
    supabase
      .from("scrape_runs")
      .select("scraper, cost_usd, success, duration_ms, method, completed_at")
      .gte("completed_at", cutoff),
    supabase
      .from("search_queries")
      .select(
        "total_candidates, total_scraped, total_leads_returned, total_cost_usd, duration_ms, created_at",
      )
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const scrapeRuns = (scrapeRunsRes.data ?? []) as ScrapeRunRow[];
  const queries = (queriesRes.data ?? []) as SearchQueryRow[];

  type PerScraper = {
    scraper: string;
    runs: number;
    successes: number;
    failures: number;
    cost_usd: number;
    avg_duration_ms: number;
    playwright_share: number;
  };
  const byScraper = new Map<string, PerScraper & { duration_sum: number; playwright: number }>();
  for (const r of scrapeRuns) {
    const entry = byScraper.get(r.scraper) ?? {
      scraper: r.scraper,
      runs: 0,
      successes: 0,
      failures: 0,
      cost_usd: 0,
      avg_duration_ms: 0,
      playwright_share: 0,
      duration_sum: 0,
      playwright: 0,
    };
    entry.runs += 1;
    if (r.success) entry.successes += 1;
    else entry.failures += 1;
    entry.cost_usd += Number(r.cost_usd ?? 0);
    entry.duration_sum += Number(r.duration_ms ?? 0);
    if (r.method === "playwright") entry.playwright += 1;
    byScraper.set(r.scraper, entry);
  }
  const per_scraper: PerScraper[] = [...byScraper.values()]
    .map((e) => ({
      scraper: e.scraper,
      runs: e.runs,
      successes: e.successes,
      failures: e.failures,
      cost_usd: round4(e.cost_usd),
      avg_duration_ms: e.runs > 0 ? Math.round(e.duration_sum / e.runs) : 0,
      playwright_share:
        e.runs > 0 ? Math.round((e.playwright / e.runs) * 100) : 0,
    }))
    .sort((a, b) => b.cost_usd - a.cost_usd);

  const scrapeTotal = scrapeRuns.reduce(
    (sum, r) => sum + Number(r.cost_usd ?? 0),
    0,
  );
  const searchTotal = queries.reduce(
    (sum, r) => sum + Number(r.total_cost_usd ?? 0),
    0,
  );

  return NextResponse.json({
    mode,
    window_days: 30,
    totals: {
      scrape_cost_usd: round4(scrapeTotal),
      search_cost_usd: round4(searchTotal),
      searches: queries.length,
    },
    per_scraper,
    recent_searches: queries,
  });
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
