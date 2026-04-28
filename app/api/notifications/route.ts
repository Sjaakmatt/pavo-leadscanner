import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { authConfigured, getCurrentUser } from "@/lib/auth/server";

export const runtime = "nodejs";

// Lijst van notificaties voor de huidige gebruiker. Default: alleen
// ongelezen + max 50 meest recente. ?all=1 toont ook gelezen.

export async function GET(req: Request) {
  if (!authConfigured()) {
    return NextResponse.json({ notifications: [], unread: 0 });
  }
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json({ notifications: [], unread: 0 });
  }
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";

  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", me.id)
    .eq("org_id", me.orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (!all) query = query.is("read_at", null);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Unread count voor de bell-badge.
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", me.id)
    .eq("org_id", me.orgId)
    .is("read_at", null);

  return NextResponse.json({ notifications: data ?? [], unread: count ?? 0 });
}

// Mark-all-read.
export async function POST() {
  if (!authConfigured()) return NextResponse.json({ ok: true });
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  const supabase = tryGetSupabase();
  if (!supabase) return NextResponse.json({ ok: true });

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", me.id)
    .eq("org_id", me.orgId)
    .is("read_at", null);

  return NextResponse.json({ ok: true });
}
