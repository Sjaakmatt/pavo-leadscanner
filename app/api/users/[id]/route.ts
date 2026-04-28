import { NextResponse } from "next/server";
import { AuthError, requireAdmin } from "@/lib/auth/server";
import { supabaseAdminClient } from "@/lib/auth/admin";
import { factum } from "@/lib/factum/client";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireAdmin();
    const { id } = await params;
    let body: { role?: "admin" | "member"; full_name?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const admin = supabaseAdminClient();

    // Target moet binnen dezelfde org zitten — anders kan een admin
    // van A in B gaan zitten rommelen.
    const { data: target } = await admin
      .from("profiles")
      .select("org_id, role, email")
      .eq("id", id)
      .maybeSingle();
    if (!target || target.org_id !== me.orgId) {
      return NextResponse.json(
        { error: "User niet gevonden in deze organisatie" },
        { status: 404 },
      );
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.role === "admin" || body.role === "member") {
      // Laatste-admin guard binnen DE EIGEN ORG (admins van andere
      // orgs tellen niet mee).
      if (body.role === "member" && id === me.id) {
        const { data: admins } = await admin
          .from("profiles")
          .select("id")
          .eq("role", "admin")
          .eq("org_id", me.orgId);
        if ((admins?.length ?? 0) <= 1) {
          return NextResponse.json(
            {
              error:
                "Je bent de enige admin in deze organisatie — promoot eerst iemand anders.",
            },
            { status: 400 },
          );
        }
      }
      updates.role = body.role;
    }
    if (body.full_name) updates.full_name = body.full_name.trim();

    const { data, error } = await admin
      .from("profiles")
      .update(updates)
      .eq("id", id)
      .eq("org_id", me.orgId)
      .select("id, email, full_name, role")
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "User niet gevonden" }, { status: 404 });
    }
    void factum.logEvent("info", `User update · ${data.email}`, {
      changedBy: me.email,
      updates,
    });
    return NextResponse.json({ user: data });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireAdmin();
    const { id } = await params;
    if (id === me.id) {
      return NextResponse.json(
        { error: "Je kan jezelf niet verwijderen — laat een admin dit doen." },
        { status: 400 },
      );
    }
    const admin = supabaseAdminClient();

    // Target moet in dezelfde org zitten als de admin die delete.
    const { data: target } = await admin
      .from("profiles")
      .select("role, email, org_id")
      .eq("id", id)
      .maybeSingle();
    if (!target || target.org_id !== me.orgId) {
      return NextResponse.json(
        { error: "User niet gevonden in deze organisatie" },
        { status: 404 },
      );
    }

    if (target.role === "admin") {
      const { data: admins } = await admin
        .from("profiles")
        .select("id")
        .eq("role", "admin")
        .eq("org_id", me.orgId);
      if ((admins?.length ?? 0) <= 1) {
        return NextResponse.json(
          {
            error:
              "Dit is de enige admin in deze organisatie — promoot eerst iemand anders.",
          },
          { status: 400 },
        );
      }
    }

    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    void factum.logEvent("info", `User verwijderd · ${target?.email ?? id}`, {
      removedBy: me.email,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
