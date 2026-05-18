import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import type { SearchFilters } from "@/lib/adapters/types";
import { resolveOwnerScope } from "@/lib/auth/server";
import { parseSearchFilters, validationErrorMessage } from "@/lib/adapters/validation";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const scope = await resolveOwnerScope(req);
  if (!scope.ownerId && !req.headers.get("x-pavo-owner")) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase niet geconfigureerd" },
      { status: 503 },
    );
  }
  let query = supabase
    .from("saved_searches")
    .select("*")
    .order("updated_at", { ascending: false });
  if (scope.orgId) query = query.eq("org_id", scope.orgId);
  query = scope.ownerId
    ? query.eq("owner_id", scope.ownerId)
    : query.eq("owner", scope.ownerLabel);
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ searches: data ?? [] });
}

export async function POST(req: Request) {
  const scope = await resolveOwnerScope(req);
  if (!scope.ownerId && !req.headers.get("x-pavo-owner")) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  let body: {
    naam?: string;
    filters?: SearchFilters;
    alert_enabled?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.naam || !body.filters) {
    return NextResponse.json(
      { error: "naam + filters vereist" },
      { status: 400 },
    );
  }
  let filters: SearchFilters;
  try {
    filters = parseSearchFilters(body.filters);
  } catch (err) {
    return NextResponse.json(
      { error: validationErrorMessage(err) },
      { status: 400 },
    );
  }

  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase niet geconfigureerd" },
      { status: 503 },
    );
  }

  const { data, error } = await supabase
    .from("saved_searches")
    .insert([
      {
        owner: scope.ownerLabel,
        owner_id: scope.ownerId,
        org_id: scope.orgId,
        naam: body.naam,
        filters: filters as unknown as object,
        alert_enabled: !!body.alert_enabled,
      },
    ])
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ search: data });
}
