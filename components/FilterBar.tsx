"use client";

import { useState } from "react";
import type { FteKlasse, SearchFilters } from "@/lib/adapters/types";
import { BRANCHE_OPTIONS, FTE_OPTIONS } from "@/lib/filter";

type Props = {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  onSubmit: () => void;
  loading: boolean;
};

export default function FilterBar({ filters, onChange, onSubmit, loading }: Props) {
  const [fteOpen, setFteOpen] = useState(false);

  function toggleFte(klasse: FteKlasse) {
    const set = new Set(filters.fte_klassen);
    if (set.has(klasse)) set.delete(klasse);
    else set.add(klasse);
    onChange({ ...filters, fte_klassen: Array.from(set) as FteKlasse[] });
  }

  const fteLabel =
    filters.fte_klassen.length === FTE_OPTIONS.length
      ? "Alle groottes"
      : filters.fte_klassen.length === 0
      ? "Geen geselecteerd"
      : filters.fte_klassen.join(", ");

  return (
    <div className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        <div className="md:col-span-2">
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
            Bedrijfsomvang
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setFteOpen((v) => !v)}
              className="w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-left text-sm text-pavo-gray-900 transition-all duration-200 hover:border-pavo-teal focus:border-pavo-teal focus:outline-none"
            >
              {fteLabel}
            </button>
            {fteOpen && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-pavo-gray-100 bg-white p-2 shadow-md">
                {FTE_OPTIONS.map((opt) => {
                  const checked = filters.fte_klassen.includes(opt);
                  return (
                    <label
                      key={opt}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-pavo-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleFte(opt)}
                        className="h-4 w-4 accent-pavo-teal"
                      />
                      {opt} FTE
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="md:col-span-3">
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
            Branche
          </label>
          <select
            value={filters.branche}
            onChange={(e) => onChange({ ...filters, branche: e.target.value })}
            className="w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 transition-all duration-200 hover:border-pavo-teal focus:border-pavo-teal focus:outline-none"
          >
            {BRANCHE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-3">
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
            Regio — plaats
          </label>
          <input
            type="text"
            value={filters.regio_plaats}
            onChange={(e) =>
              onChange({ ...filters, regio_plaats: e.target.value })
            }
            placeholder="bv. Apeldoorn"
            className="w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 transition-all duration-200 placeholder:text-pavo-gray-600/60 hover:border-pavo-teal focus:border-pavo-teal focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <input
              type="range"
              min={5}
              max={200}
              step={5}
              value={filters.regio_straal_km}
              onChange={(e) =>
                onChange({
                  ...filters,
                  regio_straal_km: Number(e.target.value),
                })
              }
              className="flex-1 accent-pavo-teal"
            />
            <span className="w-14 text-right text-xs text-pavo-gray-600">
              {filters.regio_straal_km} km
            </span>
          </div>
        </div>

        <div className="md:col-span-3">
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
            Bijzondere signalen
          </label>
          <input
            type="text"
            value={filters.signaal_query}
            onChange={(e) =>
              onChange({ ...filters, signaal_query: e.target.value })
            }
            placeholder="bv. 'hoog verloop', 'net over 50 FTE'"
            className="w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 transition-all duration-200 placeholder:text-pavo-gray-600/60 hover:border-pavo-teal focus:border-pavo-teal focus:outline-none"
          />
        </div>

        <div className="flex items-end md:col-span-1">
          <button
            type="button"
            onClick={onSubmit}
            disabled={loading || filters.fte_klassen.length === 0}
            className="w-full rounded-lg bg-pavo-teal px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-pavo-teal-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Zoekt
              </span>
            ) : (
              "Zoek leads"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
