import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { AuthError, requireUser } from "@/lib/auth/server";
import type { SearchFilters } from "@/lib/adapters/types";
import { parseSearchFilters, validationErrorMessage } from "@/lib/adapters/validation";

export const runtime = "nodejs";

export async function GET() {
  try {
    const me = await requireUser();
    const supabase = tryGetSupabase();
    if (!supabase) {
      return NextResponse.json({ jobs: [] });
    }
    const { data, error } = await supabase
      .from("search_jobs")
      .select(
        "id, naam, status, total_leads, total_cost_usd, error_message, queued_at, started_at, completed_at, use_batch, filters, search_query_id, created_by",
      )
      .eq("org_id", me.orgId)
      .order("queued_at", { ascending: false })
      .limit(50);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ jobs: data ?? [] });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const me = await requireUser();
    let body: {
      naam?: string;
      filters?: SearchFilters;
      use_batch?: boolean;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
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
      .from("search_jobs")
      .insert([
        {
          org_id: me.orgId,
          created_by: me.id,
          filters: filters as unknown as object,
          naam: body.naam ?? null,
          use_batch: body.use_batch ?? false,
          status: "queued",
        },
      ])
      .select("*")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ job: data });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
