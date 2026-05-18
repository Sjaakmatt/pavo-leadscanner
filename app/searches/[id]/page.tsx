"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import LeadGrid from "@/components/LeadGrid";
import type { Lead } from "@/lib/adapters/types";

type SearchMeta = {
  id: string;
  filters: Record<string, unknown>;
  status: string;
  total_candidates: number | null;
  total_leads_returned: number | null;
  duration_ms: number | null;
  total_cost_usd: number | null;
  created_at: string;
  completed_at: string | null;
};

type ApiResponse = {
  search: SearchMeta;
  leads: Lead[];
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
  return `€${(Number(n) / EUR_USD_RATE).toFixed(2)}`;
}

export default function SearchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/searches/${id}`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setError("Deze zoekopdracht bestaat niet (meer).");
          return;
        }
        if (res.status === 403) {
          setError("Geen toegang tot deze zoekopdracht.");
          return;
        }
        if (!res.ok) {
          setError(`Status ${res.status}`);
          return;
        }
        const body = (await res.json()) as ApiResponse;
        setData(body);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10">
      <div className="mb-4">
        <Link
          href="/searches"
          className="text-sm text-pavo-teal hover:underline"
        >
          ← terug naar geschiedenis
        </Link>
      </div>

      {loading && (
        <div className="rounded-lg border border-pavo-gray-100 bg-white p-6 text-sm text-pavo-gray-600">
          Laden…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-pavo-orange/40 bg-pavo-orange/5 p-4 text-sm text-pavo-orange">
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          <SearchHeader search={data.search} leadCount={data.leads.length} />
          <div className="mt-6">
            <LeadGrid leads={data.leads} />
          </div>
        </>
      )}
    </div>
  );
}

function SearchHeader({
  search,
  leadCount,
}: {
  search: SearchMeta;
  leadCount: number;
}) {
  const filters = search.filters as {
    branche?: string;
    regio_center?: { lat: number; lng: number } | null;
    regio_straal_km?: number;
    fte_klassen?: string[];
    signaal_query?: string;
  };
  const tijdstip = new Date(search.created_at).toLocaleString("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <div className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-pavo-navy md:text-2xl">
          {filters.branche ?? "Search"} · {tijdstip}
        </h1>
        <span className="text-sm text-pavo-gray-600">
          {leadCount} {leadCount === 1 ? "lead" : "leads"}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
        <Pair label="Branche" value={filters.branche ?? "—"} />
        <Pair
          label="Regio"
          value={
            filters.regio_center
              ? `straal ${filters.regio_straal_km ?? "?"} km`
              : "geen"
          }
        />
        <Pair
          label="FTE"
          value={
            filters.fte_klassen && filters.fte_klassen.length > 0
              ? filters.fte_klassen.join(", ")
              : "alle"
          }
        />
        <Pair label="Status" value={search.status} />
        <Pair label="Kandidaten" value={String(search.total_candidates ?? "—")} />
        <Pair label="Duur" value={fmtMs(search.duration_ms)} />
        <Pair label="Kosten" value={fmtUsd(search.total_cost_usd)} />
        {filters.signaal_query && (
          <Pair label="Query" value={filters.signaal_query} />
        )}
      </dl>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600">
        {label}
      </dt>
      <dd className="mt-0.5 text-pavo-gray-900">{value}</dd>
    </div>
  );
}
