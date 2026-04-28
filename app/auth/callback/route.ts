// Magic-link callback. Supabase stuurt de browser hierheen met een
// `?code=...` parameter; we wisselen 'm in voor een sessie en zetten
// de cookies via @supabase/ssr.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseRouteClient } from "@/lib/auth/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const from = url.searchParams.get("from") ?? "/";

  if (!code) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const supabase = await supabaseRouteClient();
  if (!supabase) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("error", error.message);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL(from, req.url));
}
