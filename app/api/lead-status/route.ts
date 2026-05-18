import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { isLeadStatus, type LeadStatus } from "@/lib/lead-status/types";
import { resolveOwnerScope } from "@/lib/auth/server";

export const runtime = "nodejs";

// Lijst-endpoint: alle statuses voor een owner binnen z'n org,
// optioneel gefilterd op specifieke status. Admins zien alle leads
// binnen de eigen org (zie RLS); deze endpoint draait via service-role
// + handmatige scoping.

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

  const scope = await resolveOwnerScope(req);
  // Geen auth + geen header = bewust niet toegestaan voor list
  // (was een privacy-risico).
  if (!scope.ownerId && !req.headers.get("x-pavo-owner")) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  let query = supabase
    .from("lead_statuses")
    .select(
      "kvk, owner, status, reden, notitie, updated_at, updated_by, companies!inner(naam, plaats, fte_klasse)",
    )
    .order("updated_at", { ascending: false });
  if (scope.orgId) query = query.eq("org_id", scope.orgId);
  query = scope.ownerId
    ? query.eq("owner_id", scope.ownerId)
    : query.eq("owner", scope.ownerLabel);

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
