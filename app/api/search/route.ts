import { NextResponse } from "next/server";
import { getLeadSource } from "@/lib/lead-source";
import { factum } from "@/lib/factum/client";
import { ESTIMATED_MINUTES_SAVED_PER_LEAD } from "@/lib/factum/roi";
import type { SearchFilters } from "@/lib/adapters/types";
import { parseSearchFilters, validationErrorMessage } from "@/lib/adapters/validation";
import { buildSearchSteps } from "@/lib/filter";
import { authConfigured, getCurrentUser } from "@/lib/auth/server";
import { checkSearchRateLimit } from "@/lib/rate-limit/search";

export async function POST(req: Request) {
  const startedAt = Date.now();
  let filters: SearchFilters | null = null;
  try {
    const url = new URL(req.url);
    const refresh = url.searchParams.get("refresh") === "true";
    try {
      filters = parseSearchFilters(await req.json());
    } catch (err) {
      return NextResponse.json(
        { error: validationErrorMessage(err) },
        { status: 400 },
      );
    }

    // Rate-limit per organisatie (alleen wanneer auth + org bekend zijn).
    if (authConfigured()) {
      const me = await getCurrentUser();
      const limit = await checkSearchRateLimit(me?.orgId ?? null);
      if (!limit.allowed) {
        return NextResponse.json(
          {
            error: `Daglimiet bereikt (${limit.count}/${limit.cap} zoekopdrachten). Probeer morgen opnieuw.`,
            count: limit.count,
            cap: limit.cap,
          },
          {
            status: 429,
            headers: limit.retryAfterSeconds
              ? { "Retry-After": String(limit.retryAfterSeconds) }
              : undefined,
          },
        );
      }
    }

    const source = getLeadSource();
    const result = await source.runSearch(filters, { refresh });
    const steps = buildSearchSteps(
      filters,
      result.leads.length,
      result.relaxation,
    );

    const durationMs = Date.now() - startedAt;
    void factum.logEvent(
      "task_completed",
      `Lead-search · ${filters.branche} (${result.leads.length} leads)`,
      {
        branche: filters.branche,
        fte_klassen: filters.fte_klassen,
        regio_straal_km: filters.regio_straal_km,
        leads_returned: result.leads.length,
        relaxation: result.relaxation,
        refresh,
        durationMs,
        mode: process.env.MODE ?? "demo",
      },
    );
    void factum.pushMetrics({
      tasksCompleted: 1,
      avgResponseTimeMs: durationMs,
      estimatedTimeSavedMinutes:
        result.leads.length * ESTIMATED_MINUTES_SAVED_PER_LEAD,
    });

    return NextResponse.json({
      steps,
      leads: result.leads,
      relaxation: result.relaxation,
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    void factum.logEvent(
      "task_failed",
      `Lead-search faalde: ${String(err)}`,
      {
        branche: filters?.branche,
        durationMs,
        mode: process.env.MODE ?? "demo",
      },
    );
    void factum.pushMetrics({ tasksFailed: 1 });
    return NextResponse.json(
      {
        steps: [],
        leads: [],
        relaxation: { regio: false, fte: false },
        error: String(err),
      },
      { status: 500 },
    );
  }
}
