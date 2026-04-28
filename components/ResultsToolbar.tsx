"use client";

import { useMemo, useState } from "react";
import type { Lead } from "@/lib/adapters/types";

export type SortKey = "warmte" | "score" | "fte" | "naam";

export type ResultFilters = {
  archetype: string | null;
  dienst: string | null;
};

type Props = {
  leads: Lead[];
  sort: SortKey;
  filters: ResultFilters;
  onSort: (s: SortKey) => void;
  onFilters: (f: ResultFilters) => void;
};

const SORT_LABELS: Record<SortKey, string> = {
  warmte: "Warmte",
  score: "Score",
  fte: "FTE",
  naam: "Naam",
};

export default function ResultsToolbar({
  leads,
  sort,
  filters,
  onSort,
  onFilters,
}: Props) {
  const [open, setOpen] = useState<"sort" | "filter" | null>(null);

  const archetypes = useMemo(() => {
    const seen = new Set<string>();
    for (const l of leads) {
      if (l.archetype) seen.add(l.archetype.naam);
    }
    return Array.from(seen).sort();
  }, [leads]);

  const diensten = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of leads) {
      for (const d of l.diensten) {
        if (d.prioriteit === "primair") seen.set(d.code, d.naam);
      }
    }
    return Array.from(seen.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [leads]);

  const activeCount =
    (filters.archetype ? 1 : 0) + (filters.dienst ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => (v === "sort" ? null : "sort"))}
          className="inline-flex items-center gap-1.5 rounded-md border border-pavo-gray-100 bg-white px-3 py-1.5 text-xs font-medium text-pavo-gray-900 hover:border-pavo-teal hover:text-pavo-teal"
        >
          Sorteer: {SORT_LABELS[sort]}
        </button>
        {open === "sort" && (
          <div className="absolute right-0 z-30 mt-1 w-40 rounded-lg border border-pavo-gray-100 bg-white p-1 shadow-md">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  onSort(k);
                  setOpen(null);
                }}
                className={`block w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  sort === k
                    ? "bg-pavo-teal/10 text-pavo-teal"
                    : "text-pavo-gray-900 hover:bg-pavo-gray-50"
                }`}
              >
                {SORT_LABELS[k]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => (v === "filter" ? null : "filter"))}
          className="inline-flex items-center gap-1.5 rounded-md border border-pavo-gray-100 bg-white px-3 py-1.5 text-xs font-medium text-pavo-gray-900 hover:border-pavo-teal hover:text-pavo-teal"
        >
          Filter
          {activeCount > 0 && (
            <span className="rounded-full bg-pavo-teal px-1.5 text-[10px] font-semibold text-white">
              {activeCount}
            </span>
          )}
        </button>
        {open === "filter" && (
          <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-pavo-gray-100 bg-white p-3 shadow-md">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600">
              Archetype
            </label>
            <select
              value={filters.archetype ?? ""}
              onChange={(e) =>
                onFilters({ ...filters, archetype: e.target.value || null })
              }
              className="mt-1 w-full rounded-md border border-pavo-gray-100 bg-white px-2 py-1.5 text-xs focus:border-pavo-teal focus:outline-none"
            >
              <option value="">Alle</option>
              {archetypes.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600">
              Primaire dienst
            </label>
            <select
              value={filters.dienst ?? ""}
              onChange={(e) =>
                onFilters({ ...filters, dienst: e.target.value || null })
              }
              className="mt-1 w-full rounded-md border border-pavo-gray-100 bg-white px-2 py-1.5 text-xs focus:border-pavo-teal focus:outline-none"
            >
              <option value="">Alle</option>
              {diensten.map(([code, naam]) => (
                <option key={code} value={code}>
                  {code} — {naam}
                </option>
              ))}
            </select>

            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => onFilters({ archetype: null, dienst: null })}
                className="mt-3 w-full rounded-md border border-pavo-gray-100 bg-white px-2 py-1 text-xs text-pavo-gray-900 hover:border-pavo-teal hover:text-pavo-teal"
              >
                Reset filters
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
