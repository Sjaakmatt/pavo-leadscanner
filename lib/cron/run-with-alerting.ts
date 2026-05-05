// Wrapper voor cron-routes. Vangt errors, logt naar cron_runs (zodat
// /api/cron/health-check ze kan aggregeren) en stuurt door naar Sentry
// als die geconfigureerd is.
//
// Gebruik in een cron-route:
//   export async function GET(req: Request) {
//     return runCronWithAlerting("refresh-active-companies", async () => {
//       // ... cron-logica
//       return { processed: 12 };
//     });
//   }

import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";

export async function runCronWithAlerting<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<NextResponse> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    void recordRun(name, "success", durationMs, undefined, result);
    return NextResponse.json({ ok: true, durationMs, result });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[cron:${name}] FAILED after ${durationMs}ms — ${message}`);
    if (stack) console.error(stack);

    void recordRun(name, "failed", durationMs, message);
    void reportToSentry(name, err);
    return NextResponse.json(
      { ok: false, durationMs, error: message },
      { status: 500 },
    );
  }
}

async function recordRun(
  name: string,
  status: "success" | "failed",
  durationMs: number,
  errorMessage?: string,
  metadata?: unknown,
): Promise<void> {
  const supabase = tryGetSupabase();
  if (!supabase) return;
  await supabase
    .from("cron_runs")
    .insert({
      cron_name: name,
      status,
      duration_ms: durationMs,
      error_message: errorMessage ?? null,
      metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null,
    })
    .then(({ error }) => {
      if (error) {
        console.warn(
          `[cron:${name}] cron_runs-insert faalde: ${error.message}`,
        );
      }
    });
}

async function reportToSentry(name: string, err: unknown): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(err, { tags: { cron: name } });
  } catch {
    // Sentry niet geladen — silently skip.
  }
}
