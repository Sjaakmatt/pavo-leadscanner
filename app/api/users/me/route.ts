import { NextResponse } from "next/server";
import {
  authConfigured,
  AuthError,
  getCurrentUser,
  requireUser,
} from "@/lib/auth/server";
import { supabaseAdminClient } from "@/lib/auth/admin";

export const runtime = "nodejs";

// "Mijn instellingen" — full_name + e-mail-voorkeuren. Iedere user
// kan z'n eigen profile lezen + bewerken (geen admin nodig).

export async function GET() {
  if (!authConfigured()) {
    return NextResponse.json({ error: "Auth uit" }, { status: 503 });
  }
  try {
    const me = await getCurrentUser();
    if (!me) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const admin = supabaseAdminClient();
    const { data } = await admin
      .from("profiles")
      .select(
        "id, email, full_name, role, notif_email_alerts, notif_email_team",
      )
      .eq("id", me.id)
      .maybeSingle();
    if (!data) {
      return NextResponse.json({ error: "Profiel niet gevonden" }, { status: 404 });
    }
    return NextResponse.json({ profile: data });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const me = await requireUser();
    let body: {
      full_name?: string;
      notif_email_alerts?: boolean;
      notif_email_team?: boolean;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (typeof body.full_name === "string") {
      updates.full_name = body.full_name.trim();
    }
    if (typeof body.notif_email_alerts === "boolean") {
      updates.notif_email_alerts = body.notif_email_alerts;
    }
    if (typeof body.notif_email_team === "boolean") {
      updates.notif_email_team = body.notif_email_team;
    }

    const admin = supabaseAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .update(updates)
      .eq("id", me.id)
      .select(
        "id, email, full_name, role, notif_email_alerts, notif_email_team",
      )
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ profile: data });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
