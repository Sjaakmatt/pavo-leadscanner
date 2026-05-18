import { NextRequest, NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { ProductionLeadSource } from "@/lib/lead-source";
import { factum } from "@/lib/factum/client";
import type { SearchFilters } from "@/lib/adapters/types";
import { requireCronAuth } from "@/lib/cron/auth";

// Vercel cron — elke 2 minuten. Pakt MAX 1 queued job en draait 'm
// volledig synchroon binnen deze cron-tick. Het next.config maxDuration
// op 800 zorgt dat een grote batch-search past binnen de Vercel-Pro
// limit; voor jobs met 200+ companies kan een tweede cron-tick 'm
// later afmaken (job blijft running, runner ziet 'm en pakt 'm niet
// opnieuw op).

export const maxDuration = 800;

export async function GET(req: NextRequest) {
  const authError = requireCronAuth(req);
  if (authError) return authError;
  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json({
      skipped: true,
      reason: "Supabase niet geconfigureerd",
    });
  }

  // Pak de oudste queued job. Slechts één per cron-tick zodat we de
  // 800s window niet uitputten met 5 jobs naast elkaar.
  const { data: jobs } = await supabase
    .from("search_jobs")
    .select("id, org_id, created_by, filters, naam, use_batch")
    .eq("status", "queued")
    .order("queued_at", { ascending: true })
    .limit(1);
  const job = (jobs ?? [])[0] as
    | {
        id: string;
        org_id: string;
        created_by: string | null;
        filters: SearchFilters;
        naam: string | null;
        use_batch: boolean;
      }
    | undefined;
  if (!job) {
    return NextResponse.json({ ok: true, picked: 0 });
  }

  // Lock optimistically — markeer als running zodat een volgende
  // tick deze niet ook nog pakt. Race-bestendig genoeg voor één-cron-
  // setup.
  const startedAt = new Date().toISOString();
  await supabase
    .from("search_jobs")
    .update({ status: "running", started_at: startedAt })
    .eq("id", job.id)
    .eq("status", "queued");

  // Runtime-check: als de UPDATE niemand had geraakt is iemand anders
  // ons voor geweest. Veiliger: lees status terug.
  const { data: still } = await supabase
    .from("search_jobs")
    .select("status")
    .eq("id", job.id)
    .maybeSingle();
  if (still?.status !== "running") {
    return NextResponse.json({
      ok: true,
      picked: 0,
      reason: "Job al opgepakt door andere worker",
    });
  }

  const source = new ProductionLeadSource();
  const tStart = Date.now();
  try {
    const result = await source.runSearch(job.filters, {
      orgId: job.org_id,
      ownerId: job.created_by,
    });

    await supabase
      .from("search_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        total_leads: result.leads.length,
      })
      .eq("id", job.id);

    if (job.created_by) {
      await supabase.from("notifications").insert([
        {
          user_id: job.created_by,
          org_id: job.org_id,
          saved_search_id: null,
          kvk: null,
          type: "system",
          title: `Achtergrond-search klaar — ${result.leads.length} leads`,
          body: job.naam
            ? `Job "${job.naam}" is afgerond. Bekijk de resultaten op /search-jobs/${job.id}.`
            : `Achtergrond-zoekopdracht afgerond.`,
          metadata: {
            job_id: job.id,
            total_leads: result.leads.length,
            duration_ms: Date.now() - tStart,
          },
        },
      ]);
    }

    void factum.logEvent(
      "task_completed",
      `Search-job ${job.id} klaar · ${result.leads.length} leads`,
      { job_id: job.id, org_id: job.org_id, duration_ms: Date.now() - tStart },
    );

    return NextResponse.json({
      ok: true,
      picked: 1,
      job_id: job.id,
      leads: result.leads.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("search_jobs")
      .update({
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    if (job.created_by) {
      await supabase.from("notifications").insert([
        {
          user_id: job.created_by,
          org_id: job.org_id,
          saved_search_id: null,
          kvk: null,
          type: "system",
          title: "Achtergrond-search faalde",
          body: message.slice(0, 240),
          metadata: { job_id: job.id },
        },
      ]);
    }

    return NextResponse.json(
      { ok: false, picked: 1, job_id: job.id, error: message },
      { status: 500 },
    );
  }
}
