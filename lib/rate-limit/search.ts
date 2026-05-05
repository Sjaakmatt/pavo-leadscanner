// Per-organisatie rate-limit op /api/search. Voorkomt dat één klant
// het org-budget in één dag opmaakt door honderden searches achter
// elkaar af te vuren.
//
// Configureerbaar via ORG_DAILY_SEARCH_CAP env (default 50). Demo-mode
// + niet-ingelogde calls worden niet gelimit; daar is geen org-context.

import { tryGetSupabase } from "@/lib/supabase/client";

const DEFAULT_CAP = 50;

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  cap: number;
  retryAfterSeconds?: number;
}

export async function checkSearchRateLimit(
  orgId: string | null,
): Promise<RateLimitResult> {
  const cap = Number(process.env.ORG_DAILY_SEARCH_CAP) || DEFAULT_CAP;

  if (!orgId) {
    return { allowed: true, count: 0, cap };
  }
  const supabase = tryGetSupabase();
  if (!supabase) {
    return { allowed: true, count: 0, cap };
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("daily_search_count")
    .select("search_count")
    .eq("org_id", orgId)
    .eq("run_date", today)
    .maybeSingle();

  if (error) {
    // Bij DB-fout: niet blokkeren — anders blokkeren we de hele app
    // wanneer Supabase even traag is. Wel loggen.
    console.warn(
      `[rate-limit] daily_search_count lookup faalde: ${error.message} — fallback allow`,
    );
    return { allowed: true, count: 0, cap };
  }

  const count = data?.search_count ?? 0;
  if (count >= cap) {
    // Tot middernacht.
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCHours(24, 0, 0, 0);
    const retryAfterSeconds = Math.ceil(
      (tomorrow.getTime() - now.getTime()) / 1000,
    );
    return { allowed: false, count, cap, retryAfterSeconds };
  }
  return { allowed: true, count, cap };
}
