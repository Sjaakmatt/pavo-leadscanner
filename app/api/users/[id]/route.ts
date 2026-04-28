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
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.role === "admin" || body.role === "member") {
      // Veiligheids-check: een admin mag zichzelf niet downgraden als hij
      // de laatste admin is — anders zit niemand meer in de cockpit.
      if (body.role === "member" && id === me.id) {
        const { data: admins } = await admin
          .from("profiles")
          .select("id")
          .eq("role", "admin");
        if ((admins?.length ?? 0) <= 1) {
          return NextResponse.json(
            {
              error:
                "Je bent de enige admin — promoot eerst iemand anders voordat je jezelf downgrade.",
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

    // Veiligheids-check: nooit de laatste admin verwijderen.
    const { data: target } = await admin
      .from("profiles")
      .select("role, email")
      .eq("id", id)
      .maybeSingle();
    if (target?.role === "admin") {
      const { data: admins } = await admin
        .from("profiles")
        .select("id")
        .eq("role", "admin");
      if ((admins?.length ?? 0) <= 1) {
        return NextResponse.json(
          {
            error:
              "Dit is de enige admin — je kan 'm niet verwijderen zonder eerst iemand anders te promoten.",
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
