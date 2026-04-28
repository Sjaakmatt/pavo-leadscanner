import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { isLeadStatus, type LeadStatus } from "@/lib/lead-status/types";
import { authConfigured, getCurrentUser } from "@/lib/auth/server";

export const runtime = "nodejs";

// Lijst-endpoint: alle statuses voor een owner, optioneel gefilterd op
// een specifieke status. Gebruikt door de "mijn pipeline"-view.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase niet geconfigureerd" },
      { status: 503 },
    );
  }

  let ownerId: string | null = null;
  let owner = "default";
  if (authConfigured()) {
    const me = await getCurrentUser();
    if (!me) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    ownerId = me.id;
    owner = me.email;
  } else {
    owner = req.headers.get("x-pavo-owner")?.trim() || "default";
  }

  let query = supabase
    .from("lead_statuses")
    .select(
      "kvk, owner, status, reden, notitie, updated_at, updated_by, companies!inner(naam, plaats, fte_klasse)",
    )
    .order("updated_at", { ascending: false });
  query = ownerId ? query.eq("owner_id", ownerId) : query.eq("owner", owner);

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
