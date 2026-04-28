// Browser-side Supabase auth client. Wordt gebruikt door /login om
// de magic link te versturen via signInWithOtp(). De callback gebeurt
// server-side (zie app/auth/callback) zodat de cookie-set correct is.

"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function authConfiguredOnClient(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function supabaseBrowserClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY ontbreken — auth is niet beschikbaar.",
    );
  }
  cached = createBrowserClient(url, anonKey);
  return cached;
}
