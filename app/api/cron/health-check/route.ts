// Dagelijkse health-check op cron_runs. Stuurt Slack-webhook bij ≥1
// failed run binnen het venster van 24 uur. Idempotent: meerdere runs
// per dag zijn OK, ze sturen alleen nogmaals een Slack-melding (handig
// als ops 'm gemist heeft).
//
// Roosters via Vercel cron in vercel.json:
//   { "path": "/api/cron/health-check", "schedule": "0 8 * * *" }

import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";

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
        `• *${f.cron_name}* — ${(f.error_message ?? "geen bericht").slice(0, 200)}`,
    )
    .join("\n");
  const text = `🚨 *${failures.length} cron-failures in laatste ${WINDOW_HOURS}u*\n${summary}`;

  await sendSlack(text);
  return NextResponse.json({ ok: true, failures: failures.length, alerted: true });
}

async function sendSlack(text: string): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    console.warn("[health-check] SLACK_WEBHOOK_URL ontbreekt — alert niet verstuurd");
    return;
  }
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
