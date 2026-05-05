// Auth-middleware. Protectt alle routes wanneer Supabase geconfigureerd
// is — demo zonder Supabase blijft volledig open zodat zero-config
// blijft werken.
//
// Public-paths (ook met auth aan): /login, /auth/callback,
// /api/auth/*, /api/cron/*, /api/mode, /api/health, statics.
//
// Refresht ook de session-cookie zodat de access-token niet expireert
// midden in een sessie.
//
// Demo-mode firewall: wanneer MODE=demo dragen we alle prod-data API's
// af zodat een klant die de demo bekijkt geen geschiedenis/jobs/users
// uit eerdere prod-runs kan zien lekken.

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

// API-paden die in demo-mode geblokkeerd worden zodat prod-data niet
// zichtbaar is. /api/search en /api/lead/[kvk] werken WEL in demo (die
// gebruiken getLeadSource() en pakken automatisch de mock).
//
// /api/search-summary, /api/compare en /api/brief blijven NIET in deze
// lijst — dat zijn stateless aggregators die op input werken (huidige
// leads/filters), niet op stored prod-data.
const PROD_ONLY_API_PREFIXES = [
  "/api/searches",
  "/api/search-jobs",
  "/api/lead-status",
  "/api/notifications",
  "/api/companies",
  "/api/saved-searches",
  "/api/organization",
  "/api/costs",
  "/api/users",
  "/api/export",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}.`),
  );
}

function isProdOnlyApi(pathname: string): boolean {
  return PROD_ONLY_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const mode = (process.env.MODE ?? "demo").toLowerCase();
  const pathname = req.nextUrl.pathname;

  // Demo-mode: GEEN auth-vereiste — klant moet direct naar binnen kunnen
  // zonder magic-link-flow. Wel firewallen we prod-data API's zodat geen
  // Supabase-data uit eerdere prod-runs doorlekt.
  if (mode === "demo") {
    // Auth-routes zijn betekenisloos in demo. Iemand die /login of
    // /auth/callback aanroept (bv. via een oude bookmark of cached
    // redirect) sturen we direct door naar de homepage.
    if (pathname === "/login" || pathname.startsWith("/auth/")) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    if (isProdOnlyApi(pathname)) {
      return NextResponse.json(
        {
          error: "Niet beschikbaar in demo-mode",
          // Empty containers in elke shape die client-fetchers verwachten
          // — voorkomt 'Cannot read .length of undefined'-crashes.
          searches: [],
          jobs: [],
          items: [],
          notifications: [],
          users: [],
          profiles: [],
          leads: [],
          statuses: [],
          history: [],
          saved_searches: [],
          company: null,
          organization: null,
          costs: { totalUsd: 0, lines: [] },
        },
        { status: 200 },
      );
    }
    // Pages renderen vrij door zonder auth-check — Header.tsx + pages
    // tonen empty-states / mock-data gracefully.
    return NextResponse.next();
  }

  // Auth uit als Supabase niet geconfigureerd is.
  if (!url || !anonKey) return NextResponse.next();
  if (isPublic(pathname)) return NextResponse.next();

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
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Run op alles behalve next-internal assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
