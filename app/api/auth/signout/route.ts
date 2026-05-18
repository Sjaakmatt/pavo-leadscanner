import { NextResponse } from "next/server";
import { supabaseRouteClient } from "@/lib/auth/server";

export async function POST() {
  const supabase = await supabaseRouteClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  return NextResponse.json({ ok: true });
}
