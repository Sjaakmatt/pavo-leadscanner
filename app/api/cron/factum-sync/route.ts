import { NextRequest, NextResponse } from "next/server";
import { factum } from "@/lib/factum/client";
import { collectDailyMetrics } from "@/lib/factum/metrics-aggregator";
import { requireCronAuth } from "@/lib/cron/auth";

/**
 * Vercel Cron — elke 5 minuten.
 *
 * Stuurt heartbeat + dagcijfers van vandaag naar het FactumAI-dashboard
 * in één batch-call. Het dashboard markeert agents na ~10 min zonder
 * heartbeat als offline, dus 5 min geeft comfortabele marge.
 *
 * Op Vercel-serverless leeft een lambda-instance maar kort, dus de
 * setInterval-heartbeat uit `instrumentation.ts` is daar geen optie.
 * Deze cron-route is de canonical heartbeat zodra de app op Vercel
 * draait. Lokaal kun je 'm gewoon met curl triggeren.
 *
 * Auth: Vercel zet `Authorization: Bearer <CRON_SECRET>` op cron-calls.
 * In production failt de route gesloten wanneer CRON_SECRET ontbreekt.
 */

let connectedThisInstance = false;

export async function GET(req: NextRequest) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  if (!factum.enabled) {
    return NextResponse.json({
      skipped: true,
      reason: "FACTUM_DASHBOARD_URL/FACTUM_API_KEY niet geconfigureerd",
    });
  }

  // Connect bij eerste tick van deze lambda-instance. `factum.connect`
  // is intern al idempotent (`this.connected` flag), dus dubbel-call
  // is goedkoop maar overbodig.
  if (!connectedThisInstance) {
    await factum.connect({
      version:
        process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
        process.env.npm_package_version ??
        "dev",
      hostname: process.env.VERCEL_URL ?? "pavo-leadscanner",
      runtime: `nodejs-${process.version}`,
    });
    connectedThisInstance = true;
  }

  const started = Date.now();
  const metrics = await collectDailyMetrics();
  const collectMs = Date.now() - started;

  await factum.sendBatch({
    heartbeat: { status: "online", responseTimeMs: collectMs },
    metrics,
  });

  return NextResponse.json({ ok: true, metrics, collectMs });
}

export const maxDuration = 30;
