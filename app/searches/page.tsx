"use client";

import Link from "next/link";
import { useCachedFetch } from "@/lib/hooks/use-cached-fetch";
import {
  fetchSearches,
  SEARCHES_KEY,
  type SearchRow,
} from "@/lib/hooks/fetchers";

function fmtAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s geleden`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m geleden`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}u geleden`;
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
  });
}

function fmtMs(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// EUR_USD_RATE blijft in lib/classification/cost.ts; consumer-side
// hardcoded zodat we 'm niet in elke client-render hoeven te ophalen.
const EUR_USD_RATE = 1.1;
function fmtUsd(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `€${(Number(n) / EUR_USD_RATE).toFixed(2)}`;
}

function statusPillCls(status: string): string {
  if (status === "completed") return "bg-emerald-50 text-emerald-700";
  if (status === "running") return "bg-pavo-teal/10 text-pavo-teal";
  if (status === "failed") return "bg-pavo-orange/10 text-pavo-orange";
  return "bg-pavo-gray-100 text-pavo-gray-600";
}

export default function SearchesPage() {
  const result = useCachedFetch(SEARCHES_KEY, fetchSearches);
  const payload = result.kind === "ready" ? result.data : null;
  const loading = result.kind === "loading";
  const error = payload?.kind === "error" ? payload.message : null;
  const rows: SearchRow[] = payload?.kind === "ok" ? payload.data : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-pavo-navy md:text-3xl">
        Geschiedenis
      </h1>
      <p className="mt-2 text-sm text-pavo-gray-600">
        Eerdere zoekopdrachten van jouw organisatie. Klik een rij om de
        leads van die run terug te zien.
      </p>

      {loading && (
        <div className="mt-6 rounded-lg border border-pavo-gray-100 bg-white p-6 text-sm text-pavo-gray-600">
          Laden…
        </div>
      )}

      {!loading && error && (
        <div className="mt-6 rounded-lg border border-pavo-orange/40 bg-pavo-orange/5 p-4 text-sm text-pavo-orange">
          {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="mt-6 rounded-lg border border-pavo-gray-100 bg-white p-10 text-center text-sm text-pavo-gray-600">
          Nog geen zoekopdrachten — start er één via de hoofdpagina.
          <div className="mt-3">
            <Link
              href="/"
              className="inline-block rounded bg-pavo-teal px-4 py-1.5 text-xs font-medium text-white hover:bg-pavo-teal/90"
            >
              Naar zoeken
            </Link>
          </div>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-pavo-gray-100 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-pavo-gray-100 bg-pavo-gray-50/40 text-pavo-gray-600">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide">Tijdstip</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide">Branche</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide">Regio</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide">Kandidaten</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide">Leads</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide">Duur</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide">Kosten</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const filters = r.filters as {
                  branche?: string;
                  regio_center?: { lat: number; lng: number } | null;
                  regio_straal_km?: number;
                };
                const branche = filters.branche ?? "—";
                const regio = filters.regio_center
                  ? `${filters.regio_center.lat.toFixed(2)}, ${filters.regio_center.lng.toFixed(2)} · ${filters.regio_straal_km ?? "?"}km`
                  : "—";
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-pavo-gray-100/70 transition-colors last:border-0 hover:bg-pavo-gray-50/40"
                  >
                    <td className="px-3 py-3">
                      <Link
                        href={`/searches/${r.id}`}
                        className="block text-pavo-gray-900"
                        title={new Date(r.created_at).toLocaleString("nl-NL")}
                      >
                        {fmtAge(r.created_at)}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-pavo-gray-900">
                      <Link href={`/searches/${r.id}`} className="block">
                        {branche}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-pavo-gray-600">
                      <Link href={`/searches/${r.id}`} className="block">
                        {regio}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-pavo-gray-600">
                      <Link href={`/searches/${r.id}`} className="block">
                        {r.total_candidates ?? "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-pavo-navy">
                      <Link href={`/searches/${r.id}`} className="block">
                        {r.total_leads_returned ?? "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-pavo-gray-600">
                      <Link href={`/searches/${r.id}`} className="block">
                        {fmtMs(r.duration_ms)}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-pavo-gray-600">
                      <Link href={`/searches/${r.id}`} className="block">
                        {fmtUsd(r.total_cost_usd)}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${statusPillCls(r.status)}`}
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
