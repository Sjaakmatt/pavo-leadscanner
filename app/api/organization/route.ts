import { NextResponse } from "next/server";
import { AuthError, requireAdmin, requireUser } from "@/lib/auth/server";
import { supabaseAdminClient } from "@/lib/auth/admin";

export const runtime = "nodejs";

// GET — info over eigen organization (iedereen mag lezen).
export async function GET() {
  try {
    const me = await requireUser();
    const admin = supabaseAdminClient();
    const { data } = await admin
      .from("organizations")
      .select("id, naam, slug, created_at")
      .eq("id", me.orgId)
      .maybeSingle();
    return NextResponse.json({ organization: data });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH — admin-only rename. Slug houden we automatisch in sync uit de
// naam, maar simpel: lowercase, spaces→dash, max 32 chars.
export async function PATCH(req: Request) {
  try {
    const me = await requireAdmin();
    let body: { naam?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const naam = body.naam?.trim();
    if (!naam) {
      return NextResponse.json({ error: "Naam vereist" }, { status: 400 });
    }
    const slug = naam
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32);

    const admin = supabaseAdminClient();
    const { data, error } = await admin
      .from("organizations")
      .update({ naam, slug, updated_at: new Date().toISOString() })
      .eq("id", me.orgId)
      .select("id, naam, slug")
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ organization: data });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
