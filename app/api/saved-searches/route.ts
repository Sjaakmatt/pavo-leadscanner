import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import type { SearchFilters } from "@/lib/adapters/types";

export const runtime = "nodejs";

function resolveOwner(req: Request): string {
  return req.headers.get("x-pavo-owner")?.trim() || "default";
}

export async function GET(req: Request) {
  const owner = resolveOwner(req);
  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase niet geconfigureerd" },
      { status: 503 },
    );
  }
  const { data, error } = await supabase
    .from("saved_searches")
    .select("*")
    .eq("owner", owner)
    .order("updated_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ searches: data ?? [] });
}

export async function POST(req: Request) {
  const owner = resolveOwner(req);

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
        owner,
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
