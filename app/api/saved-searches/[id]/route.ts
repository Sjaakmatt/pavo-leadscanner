import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { authConfigured, getCurrentUser } from "@/lib/auth/server";

export const runtime = "nodejs";

async function resolveOwner(
  req: Request,
): Promise<{ owner: string; ownerId: string | null } | { error: string; status: number }> {
  if (authConfigured()) {
    const me = await getCurrentUser();
    if (!me) return { error: "Niet ingelogd", status: 401 };
    return { owner: me.email, ownerId: me.id };
  }
  return {
    owner: req.headers.get("x-pavo-owner")?.trim() || "default",
    ownerId: null,
  };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ow = await resolveOwner(req);
  if ("error" in ow) {
    return NextResponse.json({ error: ow.error }, { status: ow.status });
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

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.naam === "string") update.naam = body.naam;
  if (typeof body.alert_enabled === "boolean") {
    update.alert_enabled = body.alert_enabled;
  }
  if (body.filters && typeof body.filters === "object") {
    update.filters = body.filters;
  }

  const baseQuery = supabase
    .from("saved_searches")
    .update(update)
    .eq("id", id);
  const { data, error } = await (ow.ownerId
    ? baseQuery.eq("owner_id", ow.ownerId)
    : baseQuery.eq("owner", ow.owner)
  )
    .select("*")
    .maybeSingle();
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
  const ow = await resolveOwner(req);
  if ("error" in ow) {
    return NextResponse.json({ error: ow.error }, { status: ow.status });
  }
  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase niet geconfigureerd" },
      { status: 503 },
    );
  }
  const baseQuery = supabase.from("saved_searches").delete().eq("id", id);
  const { error } = await (ow.ownerId
    ? baseQuery.eq("owner_id", ow.ownerId)
    : baseQuery.eq("owner", ow.owner));
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
