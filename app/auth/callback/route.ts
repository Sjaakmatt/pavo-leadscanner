// Magic-link callback. Supabase stuurt de browser hierheen met een
// `?code=...` parameter; we wisselen 'm in voor een sessie en zetten
// de cookies via @supabase/ssr.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseRouteClient } from "@/lib/auth/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const from = url.searchParams.get("from") ?? "/";
  const ua = req.headers.get("user-agent")?.slice(0, 100) ?? "?";
  const incomingCookies = req.cookies.getAll().map((c) => c.name);
  // Diagnostiek: Safari/iOS magic-link flow valt soms stil. Log de
  // essentiële stappen via Vercel-logs zodat we via één search per
  // request-id de hele flow kunnen reconstrueren.
  console.log(
    `[auth/callback] hit code=${code ? "yes" : "no"} from=${from} cookies=[${incomingCookies.join(",")}] ua=${ua}`,
  );

  if (!code) {
    console.warn("[auth/callback] no ?code → redirect /login");
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const supabase = await supabaseRouteClient();
  if (!supabase) {
    console.warn("[auth/callback] supabaseRouteClient() = null (env missing?) → /login");
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.warn(`[auth/callback] exchange failed: ${error.message}`);
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("error", error.message);
    return NextResponse.redirect(loginUrl);
  }
  console.log(
    `[auth/callback] exchange OK userId=${data.user?.id ?? "?"} email=${data.user?.email ?? "?"} hasSession=${data.session ? "yes" : "no"}`,
  );

  return NextResponse.redirect(new URL(from, req.url));
}
