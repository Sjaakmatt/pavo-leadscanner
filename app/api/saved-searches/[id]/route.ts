import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { resolveOwnerScope } from "@/lib/auth/server";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = await resolveOwnerScope(req);
  if (!scope.ownerId && !req.headers.get("x-pavo-owner")) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  let body: { naam?: string; alert_enabled?: boolean; filters?: object };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase niet geconfigureerd" },
      { status: 503 },
    );
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body.naam === "string") update.naam = body.naam;
  if (typeof body.alert_enabled === "boolean") {
    update.alert_enabled = body.alert_enabled;
  }
  if (body.filters && typeof body.filters === "object") {
    update.filters = body.filters;
  }

  let baseQuery = supabase.from("saved_searches").update(update).eq("id", id);
  if (scope.orgId) baseQuery = baseQuery.eq("org_id", scope.orgId);
  baseQuery = scope.ownerId
    ? baseQuery.eq("owner_id", scope.ownerId)
    : baseQuery.eq("owner", scope.ownerLabel);
  const { data, error } = await baseQuery.select("*").maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  }
  return NextResponse.json({ search: data });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
  let baseQuery = supabase.from("saved_searches").delete().eq("id", id);
  if (scope.orgId) baseQuery = baseQuery.eq("org_id", scope.orgId);
  baseQuery = scope.ownerId
    ? baseQuery.eq("owner_id", scope.ownerId)
    : baseQuery.eq("owner", scope.ownerLabel);
  const { error } = await baseQuery;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
