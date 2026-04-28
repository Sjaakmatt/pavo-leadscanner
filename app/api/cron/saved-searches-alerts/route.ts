import { NextRequest, NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { getLeadSource } from "@/lib/lead-source";
import { factum } from "@/lib/factum/client";
import type { SearchFilters } from "@/lib/adapters/types";

// Vercel cron — runt periodiek over alle saved-searches met
// alert_enabled=true en dropt een notificatie voor iedere HOT lead die
// nog niet eerder is gemeld voor die (user, kvk, search). De notificatie-
// tabel heeft een unique constraint op (user_id, kvk, saved_search_id),
// dus dubbele inserts worden silent geslikt.
//
// Schedule wordt in vercel.json beheerd. Voor lokaal testen: gewoon
// curl met CRON_SECRET-header.

export const maxDuration = 800;

type SavedSearchRow = {
  id: string;
  owner_id: string | null;
  naam: string;
  filters: SearchFilters;
  alert_last_run_at: string | null;
};

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json({
      skipped: true,
      reason: "Supabase niet geconfigureerd",
    });
  }

  const startedAt = Date.now();
  const { data: searches, error } = await supabase
    .from("saved_searches")
    .select("id, owner_id, naam, filters, alert_last_run_at")
    .eq("alert_enabled", true)
    .not("owner_id", "is", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (searches ?? []) as SavedSearchRow[];
  const summary: Array<{
    saved_search_id: string;
    naam: string;
    matches: number;
    notifications: number;
  }> = [];

  for (const ss of rows) {
    if (!ss.owner_id) continue;
    let matches = 0;
    let notified = 0;
    try {
      const result = await getLeadSource().runSearch(ss.filters);
      const hot = result.leads.filter((l) => l.warmte === "HOT");
      matches = hot.length;

      const inserts = hot.map((lead) => ({
        user_id: ss.owner_id,
        saved_search_id: ss.id,
        kvk: lead.kvk,
        type: "saved_search_match" as const,
        title: `${lead.naam} matcht je zoekopdracht "${ss.naam}"`,
        body: lead.observatie,
        metadata: {
          warmte: lead.warmte,
          archetype: lead.archetype?.naam ?? null,
          plaats: lead.plaats,
          fte_klasse: lead.fte_klasse,
        },
      }));

      if (inserts.length > 0) {
        // ON CONFLICT DO NOTHING — Supabase-js heeft geen native
        // syntax, maar onConflict op de unique-index slikt dupes.
        const { data, error: insertErr } = await supabase
          .from("notifications")
          .upsert(inserts, {
            onConflict: "user_id,kvk,saved_search_id",
            ignoreDuplicates: true,
          })
          .select("id");
        if (insertErr) {
          console.warn(
            `[alerts-cron] insert ${ss.naam}: ${insertErr.message}`,
          );
        }
        notified = data?.length ?? 0;
      }

      await supabase
        .from("saved_searches")
        .update({ alert_last_run_at: new Date().toISOString() })
        .eq("id", ss.id);
    } catch (err) {
      console.warn(
        `[alerts-cron] saved_search ${ss.id} faalde: ${String(err)}`,
      );
    }
    summary.push({
      saved_search_id: ss.id,
      naam: ss.naam,
      matches,
      notifications: notified,
    });
  }

  const durationMs = Date.now() - startedAt;
  void factum.logEvent(
    "info",
    `Saved-search alerts: ${rows.length} run, ${summary.reduce(
      (s, r) => s + r.notifications,
      0,
    )} notificaties`,
    { durationMs, summary },
  );

  return NextResponse.json({
    ok: true,
    durationMs,
    summary,
  });
}
