import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { AuthError, requireUser } from "@/lib/auth/server";

export const runtime = "nodejs";

// Status-poll voor één job. Iedere user binnen z'n eigen org mag
// elke job zien (handig voor admin-monitoring).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireUser();
    const { id } = await params;
    const supabase = tryGetSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase uit" }, { status: 503 });
    }
    const { data, error } = await supabase
      .from("search_jobs")
      .select("*")
      .eq("id", id)
      .eq("org_id", me.orgId)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }
    return NextResponse.json({ job: data });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Cancel — alleen queued of running. Eigenaar of admin.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireUser();
    const { id } = await params;
    const supabase = tryGetSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase uit" }, { status: 503 });
    }
    const { data: job } = await supabase
      .from("search_jobs")
      .select("status, created_by, org_id")
      .eq("id", id)
      .eq("org_id", me.orgId)
      .maybeSingle();
    if (!job) {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }
    if (job.created_by !== me.id && me.role !== "admin") {
      return NextResponse.json({ error: "Niet jouw job" }, { status: 403 });
    }
    if (job.status !== "queued" && job.status !== "running") {
      return NextResponse.json(
        { error: `Kan ${job.status}-job niet cancelen` },
        { status: 400 },
      );
    }
    await supabase
      .from("search_jobs")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
      })
      .eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
