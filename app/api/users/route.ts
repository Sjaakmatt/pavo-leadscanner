import { NextResponse } from "next/server";
import {
  authConfigured,
  AuthError,
  getCurrentUser,
  requireAdmin,
} from "@/lib/auth/server";
import { supabaseAdminClient } from "@/lib/auth/admin";
import { factum } from "@/lib/factum/client";

export const runtime = "nodejs";

// Lijst alle profiles. Authenticated users zien iedereen; alleen
// admins zien admin-acties.
export async function GET() {
  try {
    if (!authConfigured()) {
      return NextResponse.json(
        { error: "Auth niet geconfigureerd" },
        { status: 503 },
      );
    }
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const admin = supabaseAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("id, email, full_name, role, invited_by, created_at, updated_at")
      .order("created_at", { ascending: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      users: data ?? [],
      currentUser: user,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Nodig één user uit per e-mail. Alleen admins.
export async function POST(req: Request) {
  try {
    const me = await requireAdmin();
    let body: { email?: string; role?: "admin" | "member"; full_name?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const email = body.email?.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Geldige e-mail vereist" }, { status: 400 });
    }
    const role = body.role === "admin" ? "admin" : "member";

    const admin = supabaseAdminClient();
    const origin =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
    const redirectTo = origin ? `${origin}/auth/callback` : undefined;

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        full_name: body.full_name?.trim() || email,
        invited_by: me.id,
      },
    });
    if (error || !data.user) {
      return NextResponse.json(
        { error: error?.message ?? "Invite faalde" },
        { status: 500 },
      );
    }

    // Profile-trigger zet 'm met default role=member; admins kunnen 'm
    // direct upgraden naar admin als gewenst.
    const updates: Record<string, unknown> = {
      email,
      full_name: body.full_name?.trim() || email,
      invited_by: me.id,
      updated_at: new Date().toISOString(),
    };
    if (role === "admin") updates.role = "admin";
    await admin.from("profiles").upsert(
      [{ id: data.user.id, ...updates }],
      { onConflict: "id" },
    );

    void factum.logEvent("info", `Gebruiker uitgenodigd · ${email}`, {
      invitedBy: me.email,
      role,
    });

    return NextResponse.json({
      user: { id: data.user.id, email, role, full_name: updates.full_name },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
