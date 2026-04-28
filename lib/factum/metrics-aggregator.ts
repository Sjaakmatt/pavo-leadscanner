// Aggregeer dagcijfers voor de FactumAI-dashboard heartbeat. Wordt
// aangeroepen door de Vercel-cron (`/api/cron/factum-sync`, elke 5 min)
// en stuurt totals voor vandaag mee in de batch-call.
//
// In demo-mode (geen Supabase) leveren we lege metrics op — de cron
// blijft dan draaien als pure heartbeat zodat het dashboard de agent
// als "online" markeert.
import { tryGetSupabase } from "@/lib/supabase/client";
import type { FactumMetrics } from "./client";
import { ESTIMATED_MINUTES_SAVED_PER_LEAD } from "./roi";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type SearchQueryRow = {
  status: string | null;
  duration_ms: number | null;
  total_leads_returned: number | null;
};

function emptyMetrics(date: string): FactumMetrics {
  return {
    date,
    tasksCompleted: 0,
    tasksFailed: 0,
    avgResponseTimeMs: 0,
    humanEscalations: 0,
    automationRate: 0,
    estimatedTimeSavedMinutes: 0,
  };
}

export async function collectDailyMetrics(
  dateIso?: string,
): Promise<FactumMetrics> {
  const date = dateIso ?? new Date().toISOString().slice(0, 10);
  const supabase = tryGetSupabase();
  if (!supabase) return emptyMetrics(date);

  const dayStartMs = new Date(`${date}T00:00:00.000Z`).getTime();
  const dayStart = new Date(dayStartMs).toISOString();
  const dayEnd = new Date(dayStartMs + MS_PER_DAY).toISOString();

  const { data, error } = await supabase
    .from("search_queries")
    .select("status, duration_ms, total_leads_returned")
    .gte("created_at", dayStart)
    .lt("created_at", dayEnd);

  if (error || !data) return emptyMetrics(date);

  const rows = data as SearchQueryRow[];
  const completed = rows.filter((r) => r.status === "completed");
  const failed = rows.filter((r) => r.status === "failed");

  const avgResponseTimeMs =
    completed.length > 0
      ? Math.round(
          completed.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0) /
            completed.length,
        )
      : 0;

  const totalLeads = completed.reduce(
    (sum, r) => sum + (r.total_leads_returned ?? 0),
    0,
  );

  // Net als in sunwise: rate = aandeel succesvolle taken van alle
  // afgeronde taken (completed + failed). Pending/running tellen niet
  // mee — die zijn nog niet "afgehandeld".
  const total = completed.length + failed.length;
  const automationRate =
    total > 0
      ? Math.round((completed.length / total) * 100 * 10) / 10
      : 0;

  return {
    date,
    tasksCompleted: completed.length,
    tasksFailed: failed.length,
    avgResponseTimeMs,
    humanEscalations: 0,
    automationRate,
    estimatedTimeSavedMinutes: totalLeads * ESTIMATED_MINUTES_SAVED_PER_LEAD,
  };
}
