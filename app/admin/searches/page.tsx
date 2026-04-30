// Admin-only observability over de laatste search-runs. Toont per
// query de stage-timings, classifier-kosten en lead-counts. Eenvoudige
// table — geen charts. Bedoeld om performance-bottlenecks en kosten-
// uitschieters direct zichtbaar te maken.

import Link from "next/link";
import { tryGetSupabase } from "@/lib/supabase/client";
import { authConfigured, getCurrentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  status: string | null;
  filters: Record<string, unknown>;
  total_candidates: number | null;
  total_scraped: number | null;
  total_leads_returned: number | null;
  duration_ms: number | null;
  kvk_ms: number | null;
  basisprofiel_ms: number | null;
  geo_ms: number | null;
  scrape_ms: number | null;
  score_ms: number | null;
  total_cost_usd: number | null;
  classification_calls: number | null;
  classification_input_tokens: number | null;
  classification_output_tokens: number | null;
  budget_exceeded: boolean | null;
  created_at: string;
  completed_at: string | null;
};

function fmtMs(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// total_cost_usd in DB is canonical USD; UI toont EUR.
const EUR_USD_RATE = 1.1;
function fmtUsd(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `€${(Number(n) / EUR_USD_RATE).toFixed(3)}`;
}

export default async function AdminSearchesPage() {
  if (!authConfigured()) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-pavo-navy">
          Search-observability
        </h1>
        <p className="mt-3 text-sm text-pavo-gray-600">
          Auth is niet geconfigureerd — geen tracking-data om te tonen.
        </p>
      </div>
    );
  }

  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-pavo-navy">
          Search-observability
        </h1>
        <p className="mt-3 text-sm text-pavo-gray-600">
          Alleen voor admins.
        </p>
      </div>
    );
  }

  const supabase = tryGetSupabase();
  if (!supabase) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-pavo-navy">
          Search-observability
        </h1>
        <p className="mt-3 text-sm text-pavo-gray-600">
          Supabase niet geconfigureerd.
        </p>
      </div>
    );
  }

  const { data } = await supabase
    .from("search_queries")
    .select(
      "id, status, filters, total_candidates, total_scraped, total_leads_returned, duration_ms, kvk_ms, basisprofiel_ms, geo_ms, scrape_ms, score_ms, total_cost_usd, classification_calls, classification_input_tokens, classification_output_tokens, budget_exceeded, created_at, completed_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (data ?? []) as Row[];
  const totalCost = rows.reduce(
    (s, r) => s + Number(r.total_cost_usd ?? 0),
    0,
  );
  const completed = rows.filter((r) => r.status === "completed");
  const avgDuration =
    completed.length > 0
      ? Math.round(
          completed.reduce((s, r) => s + (r.duration_ms ?? 0), 0) /
            completed.length,
        )
      : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-pavo-navy md:text-3xl">
        Search-observability
      </h1>
      <p className="mt-2 text-sm text-pavo-gray-600">
        Laatste 50 search-runs met per-stage timing en classifier-
        kosten. Bedoeld om performance- of kosten-uitschieters snel
        op te sporen.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Stat label="Totaal aantal runs" value={rows.length.toString()} />
        <Stat
          label="Gemiddelde duur (completed)"
          value={fmtMs(avgDuration)}
        />
        <Stat label="Classifier-kosten (50 runs)" value={fmtUsd(totalCost)} />
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-pavo-gray-100 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead className="border-b border-pavo-gray-100 bg-pavo-gray-50/40 text-pavo-gray-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Tijdstip</th>
              <th className="px-3 py-2 text-left font-medium">Branche</th>
              <th className="px-3 py-2 text-right font-medium">Kand.</th>
              <th className="px-3 py-2 text-right font-medium">Scrap.</th>
              <th className="px-3 py-2 text-right font-medium">Leads</th>
              <th className="px-3 py-2 text-right font-medium">Totaal</th>
              <th className="px-3 py-2 text-right font-medium">KvK</th>
              <th className="px-3 py-2 text-right font-medium">Geo</th>
              <th className="px-3 py-2 text-right font-medium">Scrape</th>
              <th className="px-3 py-2 text-right font-medium">Score</th>
              <th className="px-3 py-2 text-right font-medium">Calls</th>
              <th className="px-3 py-2 text-right font-medium">$</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const branche =
                (r.filters as { branche?: string })?.branche ?? "—";
              return (
                <tr
                  key={r.id}
                  className="border-b border-pavo-gray-100/70 last:border-0"
                >
                  <td className="px-3 py-2 text-pavo-gray-600">
                    {new Date(r.created_at).toLocaleString("nl-NL", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="px-3 py-2 text-pavo-gray-900">{branche}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.total_candidates ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.total_scraped ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.total_leads_returned ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMs(r.duration_ms)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMs(r.kvk_ms)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMs(r.geo_ms)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMs(r.scrape_ms)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMs(r.score_ms)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-pavo-gray-600">
                    {r.classification_calls ?? 0}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      r.budget_exceeded ? "font-semibold text-pavo-orange" : ""
                    }`}
                  >
                    {fmtUsd(Number(r.total_cost_usd ?? 0))}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={r.status ?? "?"} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={13}
                  className="px-3 py-6 text-center text-pavo-gray-600"
                >
                  Nog geen search-runs gelogd.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-pavo-gray-600">
        <Link href="/users" className="text-pavo-teal hover:underline">
          ← terug naar admin
        </Link>
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-pavo-gray-100 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-pavo-navy">
        {value}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-emerald-50 text-emerald-700",
    running: "bg-pavo-teal/10 text-pavo-teal",
    failed: "bg-pavo-orange/10 text-pavo-orange",
    pending: "bg-pavo-gray-100 text-pavo-gray-600",
  };
  const cls = map[status] ?? "bg-pavo-gray-100 text-pavo-gray-600";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {status}
    </span>
  );
}
