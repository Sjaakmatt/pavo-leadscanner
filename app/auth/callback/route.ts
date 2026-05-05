// Magic-link callback. Supabase stuurt de browser hierheen met een
// `?code=...` parameter; we wisselen 'm in voor een sessie en zetten
// de cookies via @supabase/ssr.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseRouteClient } from "@/lib/auth/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const from = url.searchParams.get("from") ?? "/";
  const supabaseError = url.searchParams.get("error");
  const supabaseErrorCode = url.searchParams.get("error_code");
  const supabaseErrorDesc = url.searchParams.get("error_description");
  const ua = req.headers.get("user-agent")?.slice(0, 100) ?? "?";
  const incomingCookies = req.cookies.getAll().map((c) => c.name);
  console.log(
    `[auth/callback] hit code=${code ? "yes" : "no"} from=${from} cookies=[${incomingCookies.join(",")}] sbErr=${supabaseError ?? "none"}/${supabaseErrorCode ?? "none"} ua=${ua}`,
  );

  // Supabase stuurt errors via query-params door naar onze callback bij
  // bv. otp_expired ('Email link is invalid or has expired'). Wij sturen
  // de gebruiker dan met een herkenbaar bericht naar /login zodat ze
  // weten waarom 't faalt — niet stilletjes redirecten.
  if (supabaseError) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set(
      "error",
      supabaseErrorCode === "otp_expired"
        ? "Magic-link is verlopen. Vraag een nieuwe aan."
        : (supabaseErrorDesc ?? supabaseError),
    );
    return NextResponse.redirect(loginUrl);
  }

  if (!code) {
    console.warn("[auth/callback] no ?code → redirect /login");
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set(
      "error",
      "Geen geldige sessie ontvangen — vraag opnieuw een magic-link aan.",
    );
    return NextResponse.redirect(loginUrl);
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
