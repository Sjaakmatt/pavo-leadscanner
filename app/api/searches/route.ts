// Lijst met afgelopen search-runs, gescoped op de org van de huidige user.
// Gebruikt door /searches om een geschiedenis-overzicht te tonen waarin
// gebruikers terug kunnen naar leads van een eerdere run.

import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { AuthError, requireUser } from "@/lib/auth/server";

export const runtime = "nodejs";

type SearchRow = {
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

export async function GET() {
  try {
    const me = await requireUser();
    const supabase = tryGetSupabase();
    if (!supabase) {
      return NextResponse.json({ searches: [] });
    }
    const { data, error } = await supabase
      .from("search_queries")
      .select(
        "id, filters, status, total_candidates, total_leads_returned, duration_ms, total_cost_usd, created_at, completed_at",
      )
      .eq("org_id", me.orgId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ searches: (data ?? []) as SearchRow[] });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
