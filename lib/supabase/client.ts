// Supabase clients. Twee varianten:
//
//   supabaseServer() — gebruikt SERVICE_ROLE key en mag schrijven naar
//                       alle tabellen. Alleen op de server gebruiken
//                       (API routes, server components). NOOIT exporteren
//                       naar de browser.
//
//   supabaseBrowser() — gebruikt ANON key, voor client components.
//                        Bedoeld voor read-only queries met RLS-policies.
//                        We gebruiken 'm nu nog niet, maar hij staat klaar
//                        voor toekomstige client-side queries.
//
// In demo-modus kunnen deze imports achterwege blijven; de functions
// throwen pas als je ze aanroept zonder env-configuratie.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Env = {
  url: string;
  anonKey: string;
  serviceKey?: string;
};

function readEnv(): Env | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey, serviceKey };
}

function assertProdMode(): Env {
  const env = readEnv();
  if (!env) {
    throw new Error(
      "Supabase-env ontbreekt. Zet NEXT_PUBLIC_SUPABASE_URL en NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local om prod-mode te draaien.",
    );
  }
  return env;
}

// Cached server client zodat we niet per request een nieuwe maken.
let cachedServer: SupabaseClient | null = null;

export function supabaseServer(): SupabaseClient {
  if (cachedServer) return cachedServer;
  const env = assertProdMode();
  if (!env.serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY ontbreekt — vereist voor server-side writes.",
    );
  }
  cachedServer = createClient(env.url, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedServer;
}

// Browser-safe client — uses anon key. Re-created per call so that we
// don't share auth state between users.
export function supabaseBrowser(): SupabaseClient {
  const env = assertProdMode();
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false },
  });
}

// Non-throwing variant for places that want to gracefully degrade if
// Supabase isn't configured (e.g. demo-mode health checks).
export function tryGetSupabase(): SupabaseClient | null {
  try {
    return supabaseServer();
  } catch {
    return null;
  }
}
