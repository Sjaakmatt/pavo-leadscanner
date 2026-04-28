// Auth-middleware. Protectt alle routes wanneer Supabase geconfigureerd
// is — demo zonder Supabase blijft volledig open zodat zero-config
// blijft werken.
//
// Public-paths (ook met auth aan): /login, /auth/callback,
// /api/auth/*, /api/cron/*, /api/mode, /api/health, statics.
//
// Refresht ook de session-cookie zodat de access-token niet expireert
// midden in een sessie.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/api/auth",
  "/api/cron",
  "/api/mode",
  "/_next",
  "/favicon",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}.`),
  );
}

export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Auth uit als Supabase niet geconfigureerd is.
  if (!url || !anonKey) return NextResponse.next();
  if (isPublic(req.nextUrl.pathname)) return NextResponse.next();

  let response = NextResponse.next({ request: req });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }>,
      ) {
        for (const { name, value, options } of cookiesToSet) {
          req.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // API-routes krijgen 401 zodat clients het netjes kunnen
    // afhandelen; pages doen redirect naar /login.
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("from", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Run op alles behalve next-internal assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
