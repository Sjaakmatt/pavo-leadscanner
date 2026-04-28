import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { isLeadStatus, type LeadStatus } from "@/lib/lead-status/types";

export const runtime = "nodejs";

// Lijst-endpoint: alle statuses voor een owner, optioneel gefilterd op
// een specifieke status. Gebruikt door de "mijn pipeline"-view.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const owner = req.headers.get("x-pavo-owner")?.trim() || "default";
  const statusFilter = url.searchParams.get("status");
  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase niet geconfigureerd" },
      { status: 503 },
    );
  }

  let query = supabase
    .from("lead_statuses")
    .select(
      "kvk, owner, status, reden, notitie, updated_at, updated_by, companies!inner(naam, plaats, fte_klasse)",
    )
    .eq("owner", owner)
    .order("updated_at", { ascending: false });

  if (statusFilter && isLeadStatus(statusFilter)) {
    query = query.eq("status", statusFilter as LeadStatus);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: `Query faalde: ${error.message}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ statuses: data ?? [] });
}
