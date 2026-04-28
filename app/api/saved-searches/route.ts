import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import type { SearchFilters } from "@/lib/adapters/types";
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

export async function GET(req: Request) {
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
  const query = supabase
    .from("saved_searches")
    .select("*")
    .order("updated_at", { ascending: false });
  const { data, error } = await (ow.ownerId
    ? query.eq("owner_id", ow.ownerId)
    : query.eq("owner", ow.owner));
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ searches: data ?? [] });
}

export async function POST(req: Request) {
  const ow = await resolveOwner(req);
  if ("error" in ow) {
    return NextResponse.json({ error: ow.error }, { status: ow.status });
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
        owner: ow.owner,
        owner_id: ow.ownerId,
        naam: body.naam,
        filters: body.filters as unknown as object,
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
