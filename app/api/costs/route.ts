import { NextResponse } from "next/server";
import { currentMode } from "@/lib/lead-source";

// Kosten- en tool-call observability leeft in het FactumAI-dashboard
// (zie MCP_PLATFORM.md §6 — scheiding tussen consumer-business-state
// en platform-tracking). Deze endpoint blijft bestaan voor de UI maar
// retourneert alleen mode + waar de echte cijfers te vinden zijn.
//
// Wat we WEL kunnen rapporteren uit Supabase: aantal recente
// search_queries + duration. Dat is consumer-state.

import { tryGetSupabase } from "@/lib/supabase/client";

type SearchQueryRow = {
  total_candidates: number | null;
  total_scraped: number | null;
  total_leads_returned: number | null;
  duration_ms: number | null;
  status: string | null;
  created_at: string;
};

export async function GET() {
  const mode = currentMode();
  if (mode !== "prod") {
    return NextResponse.json({
      mode,
      message: "Kosten-dashboard is alleen relevant in prod-mode.",
      dashboard_url: null,
      recent_searches: [],
    });
  }

  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json(
      {
        mode,
        error:
          "Supabase niet geconfigureerd — vul NEXT_PUBLIC_SUPABASE_URL + service-role key in.",
      },
      { status: 503 },
    );
  }

  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await supabase
    .from("search_queries")
    .select(
      "total_candidates, total_scraped, total_leads_returned, duration_ms, status, created_at",
    )
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(50);

  const queries = (data ?? []) as SearchQueryRow[];

  return NextResponse.json({
    mode,
    window_days: 30,
    note: "Token + USD per MCP tool-call staan in het FactumAI-dashboard, gefilterd op organizationId=pavo-hr-production.",
    totals: {
      searches: queries.length,
      completed: queries.filter((q) => q.status === "completed").length,
      failed: queries.filter((q) => q.status === "failed").length,
    },
    recent_searches: queries,
  });
}
