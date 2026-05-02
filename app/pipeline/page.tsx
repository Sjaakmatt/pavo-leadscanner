"use client";

import Link from "next/link";
import { useCachedFetch } from "@/lib/hooks/use-cached-fetch";
import {
  LEAD_STATUSES,
  type LeadStatus,
} from "@/lib/lead-status/types";

type StatusRow = {
  kvk: string;
  owner: string;
  status: LeadStatus;
  reden: string | null;
  notitie: string | null;
  updated_at: string;
  updated_by: string | null;
  companies: {
    naam: string | null;
    plaats: string | null;
    fte_klasse: string | null;
  } | null;
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  nieuw: "Nieuw",
  shortlist: "Shortlist",
  benaderd: "Benaderd",
  gesprek: "In gesprek",
  gewonnen: "Gewonnen",
  verloren: "Verloren",
};

const STATUS_HEADER_COLOR: Record<LeadStatus, string> = {
  nieuw: "border-pavo-gray-100 text-pavo-gray-900",
  shortlist: "border-pavo-teal/30 text-pavo-teal",
  benaderd: "border-pavo-teal/40 text-pavo-teal",
  gesprek: "border-pavo-orange/40 text-pavo-orange",
  gewonnen: "border-emerald-300 text-emerald-700",
  verloren: "border-pavo-gray-200 text-pavo-gray-600",
};

type FetchResult =
  | { kind: "ok"; statuses: StatusRow[] }
  | { kind: "unavailable"; reason: string };

async function fetchPipeline(): Promise<FetchResult> {
  const res = await fetch("/api/lead-status", { cache: "no-store" });
  if (res.status === 503) {
    const body = (await res.json()) as { error?: string };
    return { kind: "unavailable", reason: body.error ?? "Pipeline niet beschikbaar" };
  }
  if (res.status === 401) {
    return { kind: "unavailable", reason: "Niet ingelogd — log eerst in." };
  }
  if (!res.ok) return { kind: "unavailable", reason: `Server gaf status ${res.status}` };
  const body = (await res.json()) as { statuses: StatusRow[] };
  return { kind: "ok", statuses: body.statuses };
}

export default function PipelinePage() {
  const result = useCachedFetch("/api/lead-status", fetchPipeline);
  const data = result.kind === "ready" ? result.data : null;
  const loading = result.kind === "loading";
  const unavailable = data?.kind === "unavailable" ? data.reason : null;
  const rows = data?.kind === "ok" ? data.statuses : [];

  const grouped = LEAD_STATUSES.map((s) => ({
    status: s,
    items: rows.filter((r) => r.status === s),
  }));

  if (unavailable) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-pavo-navy">Pipeline</h1>
        <p className="mt-3 text-sm text-pavo-gray-600">{unavailable}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-pavo-navy md:text-3xl">
            Pipeline
          </h1>
          <p className="mt-1 text-sm text-pavo-gray-600">
            Mijn leads, gegroepeerd op status. Wijzig de status vanuit de
            lead-detail pagina.
          </p>
        </div>
        <button
          type="button"
          onClick={result.refetch}
          className="rounded-md border border-pavo-gray-100 bg-white px-3 py-1.5 text-xs font-medium text-pavo-gray-900 hover:border-pavo-teal hover:text-pavo-teal"
        >
          Herladen
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {grouped.map(({ status, items }) => (
          <div
            key={status}
            className="rounded-lg border border-pavo-gray-100 bg-pavo-gray-50/40 p-3"
          >
            <div
              className={`mb-3 flex items-center justify-between border-b pb-2 text-xs font-semibold uppercase tracking-wide ${STATUS_HEADER_COLOR[status]}`}
            >
              <span>{STATUS_LABELS[status]}</span>
              <span className="rounded-full bg-white px-1.5 text-[10px]">
                {items.length}
              </span>
            </div>

            {loading && items.length === 0 && (
              <div className="space-y-2">
                <div className="h-12 animate-pulse rounded bg-white" />
                <div className="h-12 animate-pulse rounded bg-white" />
              </div>
            )}

            {!loading && items.length === 0 && (
              <p className="text-xs text-pavo-gray-600/70">Geen leads</p>
            )}

            <ul className="space-y-2">
              {items.map((row) => (
                <li key={`${row.kvk}-${row.owner}`}>
                  <Link
                    href={`/lead/${row.kvk}`}
                    className="block rounded-md border border-pavo-gray-100 bg-white p-3 text-sm shadow-sm hover:border-pavo-teal"
                  >
                    <p className="truncate font-medium text-pavo-gray-900">
                      {row.companies?.naam ?? row.kvk}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-pavo-gray-600">
                      {row.companies?.plaats ?? "—"}
                      {row.companies?.fte_klasse
                        ? ` · ${row.companies.fte_klasse} FTE`
                        : ""}
                    </p>
                    {row.reden && (
                      <p className="mt-1 line-clamp-2 text-[11px] italic text-pavo-gray-600">
                        &ldquo;{row.reden}&rdquo;
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
