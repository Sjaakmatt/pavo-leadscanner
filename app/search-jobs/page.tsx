"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCachedFetch } from "@/lib/hooks/use-cached-fetch";
import { fetchJobs, JOBS_KEY, type Job } from "@/lib/hooks/fetchers";

const STATUS_COLOR: Record<Job["status"], string> = {
  queued: "bg-pavo-gray-100 text-pavo-gray-600",
  running: "bg-pavo-teal/15 text-pavo-teal",
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-pavo-orange/15 text-pavo-orange",
  cancelled: "bg-pavo-gray-200 text-pavo-gray-600",
};

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "Wacht in rij",
  running: "Bezig",
  completed: "Klaar",
  failed: "Faalde",
  cancelled: "Geannuleerd",
};

function fmtAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s geleden`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m geleden`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}u geleden`;
  return new Date(iso).toLocaleDateString("nl-NL");
}

export default function SearchJobsPage() {
  // Auto-refresh trigger — bumpt elke 10s zodat de cache-hook
  // achtergrond-revalidatie doet (UI blijft tijdens reload zichtbaar).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const result = useCachedFetch(JOBS_KEY, fetchJobs, {
    refresh: tick,
    maxAgeMs: 10_000,
  });
  const payload = result.kind === "ready" ? result.data : null;
  const loading = result.kind === "loading";
  const error = payload?.kind === "error" ? payload.message : null;
  const jobs: Job[] = payload?.kind === "ok" ? payload.data : [];

  async function cancelJob(id: string) {
    if (!confirm("Job annuleren?")) return;
    await fetch(`/api/search-jobs/${id}`, { method: "DELETE" });
    result.refetch();
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-pavo-navy">
          Achtergrond-zoekopdrachten
        </h1>
        <p className="mt-3 text-sm text-pavo-gray-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-10">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-pavo-navy md:text-3xl">
            Achtergrond-zoekopdrachten
          </h1>
          <p className="mt-1 text-sm text-pavo-gray-600">
            Grote searches lopen via een cron-worker. Pagina ververst
            automatisch elke 10s zolang er jobs draaien.
          </p>
        </div>
        <button
          type="button"
          onClick={result.refetch}
          className="rounded-md border border-pavo-gray-100 bg-white px-3 py-1.5 text-xs font-medium text-pavo-gray-900 hover:border-pavo-teal hover:text-pavo-teal"
        >
          Herlaad
        </button>
      </div>

      {loading && jobs.length === 0 ? (
        <div className="mt-6 space-y-2">
          <div className="h-12 animate-pulse rounded bg-pavo-gray-100" />
          <div className="h-12 animate-pulse rounded bg-pavo-gray-100" />
        </div>
      ) : jobs.length === 0 ? (
        <p className="mt-6 text-sm text-pavo-gray-600">
          Nog geen achtergrond-zoekopdrachten. Vanuit de zoekpagina kun
          je een filter "in achtergrond" laten draaien.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-pavo-gray-100 rounded-lg border border-pavo-gray-100 bg-white shadow-sm">
          {jobs.map((j) => {
            const branche =
              (j.filters as { branche?: string })?.branche ?? "—";
            return (
              <li
                key={j.id}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm md:px-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLOR[j.status]}`}
                    >
                      {STATUS_LABEL[j.status]}
                    </span>
                    <p className="truncate font-medium text-pavo-gray-900">
                      {j.naam ?? `${branche} · ${fmtAge(j.queued_at)}`}
                    </p>
                  </div>
                  <p className="mt-0.5 text-xs text-pavo-gray-600">
                    Branche: {branche}
                    {j.total_leads !== null && ` · ${j.total_leads} leads`}
                    {j.use_batch && " · batch-API"}
                    {j.error_message && (
                      <span className="text-pavo-orange">
                        {" "}
                        · {j.error_message.slice(0, 80)}
                      </span>
                    )}
                  </p>
                </div>
                {(j.status === "queued" || j.status === "running") && (
                  <button
                    type="button"
                    onClick={() => cancelJob(j.id)}
                    className="text-xs text-pavo-orange hover:underline"
                  >
                    Annuleer
                  </button>
                )}
                {j.status === "completed" && j.search_query_id && (
                  <Link
                    href="/"
                    className="text-xs text-pavo-teal hover:underline"
                  >
                    Open
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
