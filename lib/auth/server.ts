// Server-side Supabase auth client. Gebruikt @supabase/ssr zodat de
// session-cookies correct worden gelezen + geschreven binnen Next.js
// Server Components en Route Handlers.
//
// Demo-mode (geen Supabase env vars) → alle helpers retourneren null;
// het ontbreken van een sessie betekent dan "open access" en de
// middleware laat alle paden door.

import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AppRole = "admin" | "member";

export type AppUser = {
  id: string;
  email: string;
  fullName: string | null;
  role: AppRole;
  orgId: string;
  orgNaam: string | null;
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

// Wrap in React.cache zodat meerdere componenten binnen dezelfde
// request (Header + page + nested layouts) maar één keer de
// auth+profile-roundtrip doen. Cache leeft per request, niet over
// requests heen — geen security-risico.
export const getCurrentUser = cache(_getCurrentUser);

async function _getCurrentUser(): Promise<AppUser | null> {
  const sb = await supabaseRouteClient();
  if (!sb) return null;
  // Diagnostiek voor de auth-flow: tel cookies + log getUser-uitkomst.
  // Vooral nuttig om te zien of een Safari/iOS-sessie de cookie wel
  // meestuurt maar Supabase 'm niet kan resolven (token expired etc).
  let cookieNames: string[] = [];
  try {
    const cookieStore = await cookies();
    cookieNames = cookieStore
      .getAll()
      .map((c) => c.name)
      .filter((n) => n.startsWith("sb-"));
  } catch {
    // OK — alleen voor logging
  }
  const { data: userResp, error: userErr } = await sb.auth.getUser();
  const user = userResp.user;
  if (!user || !user.email) {
    if (cookieNames.length > 0 || userErr) {
      // Logged "halfway through" — cookie present maar geen user, of
      // expliciet error. Dit is de Safari-failure-mode die we willen
      // zien in Vercel logs.
      console.warn(
        `[auth/getCurrentUser] no user — sb-cookies=[${cookieNames.join(",")}] err=${userErr?.message ?? "none"}`,
      );
    }
    return null;
  }

  const { data: profile } = await sb
    .from("profiles")
    .select(
      "id, email, full_name, role, org_id, organizations:org_id(naam)",
    )
    .eq("id", user.id)
    .maybeSingle();

  // Profile kan ontbreken om twee redenen:
  // 1. Race-condition tussen sign-up en handle_new_user-trigger
  // 2. User bestond al in auth.users vóór migration 005 (trigger draaide
  //    dus nooit voor 'm)
  // Self-heal: maak alsnog een profile aan met dezelfde logica als de
  // trigger (eerste user → admin + nieuwe org, rest → member in default org).
  let resolvedProfile: ProfileRow | null = (profile as unknown as ProfileRow | null);
  if (!resolvedProfile) {
    console.warn(
      `[auth/getCurrentUser] profile ontbreekt voor ${user.id} — auto-heal poging`,
    );
    resolvedProfile = await ensureProfile(user.id, user.email, user.user_metadata);
    if (!resolvedProfile) {
      console.warn(
        `[auth/getCurrentUser] auto-heal faalde voor ${user.id} — geen profile, geen org`,
      );
      return null;
    }
  }

  const org = resolvedProfile.organizations;
  return {
    id: user.id,
    email: resolvedProfile.email ?? user.email,
    fullName: resolvedProfile.full_name ?? null,
    role: (resolvedProfile.role as AppRole) ?? "member",
    orgId: resolvedProfile.org_id as string,
    orgNaam: org?.naam ?? null,
  };
}

/**
 * Maak een profiles-row + org aan voor een user die wél in auth.users
 * staat maar nog geen profile heeft. Mirror van handle_new_user-trigger
 * (zie supabase/migrations/010_organizations.sql) — alleen draait dit
 * runtime via service-role, voor users die de trigger gemist hebben.
 *
 * Gebruikt service-role client zodat we RLS bypassen voor deze
 * bootstrap-insert. Geen risico: we authenticeerden de user al via
 * auth.getUser() voor we deze functie aanroepen.
 */
type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  org_id: string;
  organizations: { naam: string } | null;
};

async function ensureProfile(
  userId: string,
  userEmail: string | undefined,
  userMeta: Record<string, unknown> | undefined,
): Promise<ProfileRow | null> {
  // Lazy import om circulaire dependency te voorkomen.
  const { tryGetSupabase } = await import("@/lib/supabase/client");
  const admin = tryGetSupabase();
  if (!admin) return null;

  const fullName =
    (userMeta?.full_name as string | undefined) ?? userEmail ?? "Onbekend";

  // Bepaal org-id: pak eerste bestaande organisatie. Als er geen org is,
  // maak een nieuwe 'PAVO' org aan en zet deze user als admin.
  let orgId: string | null = null;
  let role: "admin" | "member" = "member";
  const { data: orgs } = await admin
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1);
  if (orgs && orgs.length > 0) {
    orgId = (orgs[0] as { id: string }).id;
  } else {
    // Eerste user op een lege install — maak org + maak deze admin.
    const { data: newOrg, error: orgErr } = await admin
      .from("organizations")
      .insert({ naam: "PAVO", slug: "pavo" })
      .select("id")
      .single();
    if (orgErr || !newOrg) {
      console.warn(`[ensureProfile] org-insert faalde: ${orgErr?.message}`);
      return null;
    }
    orgId = (newOrg as { id: string }).id;
    role = "admin";
  }

  // Eerste profile-rij ever? Dan toch admin maken.
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) === 0) {
    role = "admin";
  }

  // upsert i.p.v. insert: idempotent én race-safe. Bij parallele
  // self-heal-calls (twee tabs tegelijk) was de oude insert vatbaar voor
  // duplicate-key errors die we daarna swallowed (incomplete fix). Met
  // upsert + onConflict='id' is de eerste call de enige effectieve.
  const { error: insertErr } = await admin
    .from("profiles")
    .upsert(
      {
        id: userId,
        email: userEmail ?? null,
        full_name: fullName,
        role,
        org_id: orgId,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (insertErr) {
    console.warn(`[ensureProfile] profile-upsert faalde: ${insertErr.message}`);
    return null;
  }

  // Re-fetch met org join zodat we dezelfde shape teruggeven als
  // de happy-path query in getCurrentUser().
  const { data } = await admin
    .from("profiles")
    .select("id, email, full_name, role, org_id, organizations:org_id(naam)")
    .eq("id", userId)
    .maybeSingle();
  return (data as unknown as ProfileRow) ?? null;
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

// Helper voor service-role routes: lever owner-scope (user.id) +
// org-scope (org.id) terug, valt elegant terug op een
// "default"-string bij demo-mode (geen auth) zodat bestaande endpoints
// blijven werken.
export type OwnerScope = {
  ownerLabel: string;
  ownerId: string | null;
  orgId: string | null;
  email: string;
};

export async function resolveOwnerScope(req: Request): Promise<OwnerScope> {
  if (authConfigured()) {
    const me = await getCurrentUser();
    if (me) {
      return {
        ownerLabel: me.email,
        ownerId: me.id,
        orgId: me.orgId,
        email: me.email,
      };
    }
  }
  const fallback = req.headers.get("x-pavo-owner")?.trim() || "default";
  return {
    ownerLabel: fallback,
    ownerId: null,
    orgId: null,
    email: fallback,
  };
}

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}
