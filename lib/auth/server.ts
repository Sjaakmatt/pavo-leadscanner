// Server-side Supabase auth client. Gebruikt @supabase/ssr zodat de
// session-cookies correct worden gelezen + geschreven binnen Next.js
// Server Components en Route Handlers.
//
// Demo-mode (geen Supabase env vars) → alle helpers retourneren null;
// het ontbreken van een sessie betekent dan "open access" en de
// middleware laat alle paden door.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AppRole = "admin" | "member";

export type AppUser = {
  id: string;
  email: string;
  fullName: string | null;
  role: AppRole;
};

function readEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function authConfigured(): boolean {
  return readEnv() !== null;
}

export async function supabaseRouteClient(): Promise<SupabaseClient | null> {
  const env = readEnv();
  if (!env) return null;
  const cookieStore = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }>,
      ) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component context: cookies kunnen niet geschreven
          // worden. Dat is OK — de middleware refreshet sessions.
        }
      },
    },
  });
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const sb = await supabaseRouteClient();
  if (!sb) return null;
  const { data: userResp } = await sb.auth.getUser();
  const user = userResp.user;
  if (!user || !user.email) return null;

  const { data: profile } = await sb
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: profile?.email ?? user.email,
    fullName: profile?.full_name ?? null,
    role: (profile?.role as AppRole) ?? "member",
  };
}

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthError("Niet ingelogd", 401);
  }
  return user;
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new AuthError("Alleen admins mogen dit", 403);
  }
  return user;
}

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}
