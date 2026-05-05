// Dagelijkse health-check op cron_runs. Pusht een dag-summary naar het
// FactumAI-dashboard (escalation-event bij failures) en optioneel een
// Slack-webhook voor directe paging. Idempotent: meerdere runs per dag
// zijn OK.
//
// Roosters via Vercel cron in vercel.json:
//   { "path": "/api/cron/health-check", "schedule": "0 8 * * *" }

import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { factum } from "@/lib/factum/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_HOURS = 24;

export async function GET(req: Request) {
  // Vercel-cron auth-header check.
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET) {
    return NextResponse.json({ error: "ongeautoriseerd" }, { status: 401 });
  }

  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, reason: "supabase uit" });
  }

  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();
  const { data, error } = await supabase
    .from("cron_runs")
    .select("cron_name, error_message, created_at")
    .eq("status", "failed")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  const failures = data ?? [];
  if (failures.length === 0) {
    return NextResponse.json({ ok: true, failures: 0 });
  }

  const summary = failures
    .map(
      (f) =>
        `• ${f.cron_name} — ${(f.error_message ?? "geen bericht").slice(0, 200)}`,
    )
    .join("\n");

  // Push escalation-event naar FactumAI-dashboard — daar zie je 'm
  // tussen alle andere agent-events. Alle observability gaat door
  // dezelfde funnel.
  void factum.logEvent(
    "escalation",
    `${failures.length} cron-failures in laatste ${WINDOW_HOURS}u`,
    {
      windowHours: WINDOW_HOURS,
      failureCount: failures.length,
      failures: failures.map((f) => ({
        cron_name: f.cron_name,
        error: (f.error_message ?? "").slice(0, 500),
        when: f.created_at,
      })),
    },
  );

  // Optioneel: Slack-webhook voor real-time paging. Ontbreekt 'ie dan
  // is FactumAI de enige notificatie-route.
  await sendSlack(`🚨 ${failures.length} cron-failures (laatste ${WINDOW_HOURS}u)\n${summary}`);

  return NextResponse.json({ ok: true, failures: failures.length, alerted: true });
}

async function sendSlack(text: string): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.warn(`[health-check] Slack-webhook faalde: ${String(err)}`);
  }
}
