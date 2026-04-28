"use client";

import { useEffect, useState } from "react";

type Bucket = {
  categorie: string;
  recent_count: number;
  recent_avg_sterkte: number;
  baseline_count: number;
  baseline_avg_sterkte: number;
  delta_pct: number;
};

const LABELS: Record<string, string> = {
  veel_open_vacatures: "Open vacatures",
  langlopende_vacatures: "Langlopende vacatures",
  herposte_vacatures: "Herposte vacatures",
  negatieve_reviews_chaos: "Negatieve reviews",
  verzuim_burnout_signalen: "Verzuim / burnout",
  snelle_groei: "Groeisignalen",
};

function arrowFor(delta: number): {
  symbol: string;
  cls: string;
  label: string;
} {
  if (delta >= 30) {
    return {
      symbol: "↑",
      cls: "text-pavo-orange",
      label: "stijgt sterk",
    };
  }
  if (delta >= 10) {
    return { symbol: "↗", cls: "text-pavo-orange", label: "stijgt" };
  }
  if (delta <= -30) {
    return { symbol: "↓", cls: "text-emerald-700", label: "daalt sterk" };
  }
  if (delta <= -10) {
    return { symbol: "↘", cls: "text-emerald-700", label: "daalt" };
  }
  return { symbol: "→", cls: "text-pavo-gray-600", label: "stabiel" };
}

export default function LeadTrend({ kvk }: { kvk: string }) {
  const [trends, setTrends] = useState<Bucket[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/lead/${kvk}/trend`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { trends: Bucket[] };
        if (!cancelled) setTrends(body.trends);
      } catch {
        // silent
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kvk]);

  if (trends === null) {
    return (
      <section className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm md:p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
          Trends
        </h2>
        <div className="mt-3 h-12 animate-pulse rounded bg-pavo-gray-100" />
      </section>
    );
  }

  if (trends.length === 0) return null;

  return (
    <section className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm md:p-6">
      <div className="flex items-center gap-2">
        <TrendIcon className="h-4 w-4 text-pavo-teal" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
          Trends
        </h2>
      </div>
      <p className="mt-1.5 text-xs text-pavo-gray-600">
        Laatste 30 dagen vs de 60 dagen daarvoor. Alleen categorieën met
        bewegende data — registers (faillissement, NLA) zijn binair en
        niet trend-relevant.
      </p>

      <ul className="mt-4 space-y-2.5">
        {trends.map((b) => {
          const arrow = arrowFor(b.delta_pct);
          const label = LABELS[b.categorie] ?? b.categorie;
          return (
            <li
              key={b.categorie}
              className="flex items-center justify-between gap-3 rounded-md border border-pavo-gray-100 bg-pavo-gray-50/30 px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-pavo-gray-900">{label}</p>
                <p className="text-[11px] text-pavo-gray-600">
                  {b.recent_count} recent · {b.baseline_count} eerder ·
                  gem. sterkte {Math.round(b.recent_avg_sterkte)} vs{" "}
                  {Math.round(b.baseline_avg_sterkte)}
                </p>
              </div>
              <div className={`flex items-center gap-1 text-sm ${arrow.cls}`}>
                <span className="text-lg">{arrow.symbol}</span>
                <span className="tabular-nums font-semibold">
                  {b.delta_pct > 0 ? "+" : ""}
                  {b.delta_pct}%
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TrendIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 14l4-5 3 3 5-7M14 5h3v3" />
    </svg>
  );
}
