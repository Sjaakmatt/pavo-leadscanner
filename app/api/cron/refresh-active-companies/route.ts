import { NextRequest, NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { McpHttpClient } from "@/lib/mcp/client";
import { BedrijvenMcp, requireBedrijvenUrl } from "@/lib/mcp/bedrijven";
import { VacaturesMcp, requireVacaturesUrl } from "@/lib/mcp/vacatures";
import { JuridischMcp, requireJuridischUrl } from "@/lib/mcp/juridisch";
import { NewsMcp, requireNewsUrl } from "@/lib/mcp/news";
import { runScrapeBatch, type ScrapeMcps } from "@/lib/orchestrator";
import { buildTenantContext } from "@/lib/mcp/tenant";
import { CostTracker, withSearchScope } from "@/lib/classification/cost";
import { factum } from "@/lib/factum/client";

// Vercel cron — refresht raw-payloads voor de N actiefste companies
// zodat handmatige searches near-instant uit de mcp_raw_responses cache
// kunnen lezen. Strategie:
//   1. Pak top N companies waarvan last_full_refresh_at NULL is of
//      ouder dan 7 dagen, en die in de afgelopen 30 dagen zijn opgeleverd
//      als HOT/WARM lead (sales-relevant subset).
//   2. Run scrape-batch met refreshRaw=true voor die set.
//   3. Update last_full_refresh_at.
//
// Schedule: 03:00 daily — buiten kantooruren zodat tests in de ochtend
// uit de cache lezen. Limiteer N=20 per run om kosten in de hand te
// houden; loop bouwt zo binnen ~3 weken iedere actieve company op.

export const maxDuration = 800;

const REFRESH_TTL_DAYS = 7;
const MAX_PER_RUN = 20;
const CONCURRENCY = 5;

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

  // Eerst de scored_leads filteren op recent + warm/hot, dan join met
  // companies om te kijken welke aan refresh toe zijn.
  const cutoffScored = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: scored } = await supabase
    .from("scored_leads")
    .select("kvk, warmte, created_at")
    .in("warmte", ["HOT", "WARM"])
    .gte("created_at", cutoffScored)
    .order("created_at", { ascending: false })
    .limit(500);
  if (!scored || scored.length === 0) {
    return NextResponse.json({
      ok: true,
      refreshed: 0,
      reason: "Geen recente HOT/WARM leads om te refreshen",
    });
  }
  const candidateKvks = Array.from(
    new Set(scored.map((r) => r.kvk as string)),
  );

  // Filter companies die nog refresh nodig hebben.
  const cutoffRefresh = new Date(
    Date.now() - REFRESH_TTL_DAYS * 86_400_000,
  ).toISOString();
  const { data: companies } = await supabase
    .from("companies")
    .select("kvk, naam, handelsnaam, website_url, last_full_refresh_at")
    .in("kvk", candidateKvks)
    .or(`last_full_refresh_at.is.null,last_full_refresh_at.lt.${cutoffRefresh}`)
    .order("last_full_refresh_at", { ascending: true, nullsFirst: true })
    .limit(MAX_PER_RUN);

  const todo = (companies ?? []) as Array<{
    kvk: string;
    naam: string;
    handelsnaam: string | null;
    website_url: string | null;
  }>;

  if (todo.length === 0) {
    return NextResponse.json({
      ok: true,
      refreshed: 0,
      reason: "Iedereen recent ge-refresht",
    });
  }

  // Bouw MCPs op — best-effort: als een env-var ontbreekt slaan we
  // 'm gewoon over zonder te crashen.
  let mcps: ScrapeMcps;
  try {
    mcps = {
      bedrijven: new BedrijvenMcp(new McpHttpClient(requireBedrijvenUrl())),
      vacatures: new VacaturesMcp(new McpHttpClient(requireVacaturesUrl())),
      juridisch: new JuridischMcp(new McpHttpClient(requireJuridischUrl())),
      news: new NewsMcp(new McpHttpClient(requireNewsUrl())),
    };
  } catch (err) {
    return NextResponse.json(
      { error: `MCP-config ontbreekt: ${String(err)}` },
      { status: 500 },
    );
  }

  const handles = todo.map((c) => ({
    kvk: c.kvk,
    naam: c.naam,
    websiteUrl: c.website_url ?? undefined,
    zoeknamen: [c.naam, c.handelsnaam].filter((s): s is string => !!s),
  }));

  const ctx = buildTenantContext();
  const tracker = new CostTracker();
  const startedAt = Date.now();

  await withSearchScope(
    { tracker, supabase, searchQueryId: null },
    () =>
      runScrapeBatch(handles, ctx, mcps, supabase, {
        concurrency: CONCURRENCY,
        refreshRaw: true,
        shouldAbort: () => tracker.shouldHalt(),
      }),
  );

  // Update last_full_refresh_at voor alles waar we langs zijn geweest.
  const now = new Date().toISOString();
  await supabase
    .from("companies")
    .update({ last_full_refresh_at: now })
    .in(
      "kvk",
      todo.map((c) => c.kvk),
    );

  const durationMs = Date.now() - startedAt;
  const cost = tracker.snapshot();
  void factum.logEvent(
    "info",
    `Companies-refresh: ${todo.length} bedrijven · $${cost.totalUsd.toFixed(3)}`,
    { durationMs, cost, count: todo.length },
  );

  return NextResponse.json({
    ok: true,
    refreshed: todo.length,
    durationMs,
    cost,
    budgetExceeded: cost.budgetExceeded,
  });
}
