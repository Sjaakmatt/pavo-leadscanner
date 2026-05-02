"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { FteKlasse, LatLng, SearchFilters } from "@/lib/adapters/types";
import { BRANCHE_OPTIONS, FTE_OPTIONS } from "@/lib/filter";

// Leaflet touches `window` at import time, so the map must be client-only.
const MapPicker = dynamic(() => import("./MapPicker"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-pavo-gray-100 text-sm text-pavo-gray-600">
      Kaart laden…
    </div>
  ),
});

type Props = {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  onSubmit: () => void;
  loading: boolean;
};

export default function FilterBar({
  filters,
  onChange,
  onSubmit,
  loading,
}: Props) {
  const [fteOpen, setFteOpen] = useState(false);

  function toggleFte(klasse: FteKlasse) {
    const set = new Set(filters.fte_klassen);
    if (set.has(klasse)) set.delete(klasse);
    else set.add(klasse);
    onChange({ ...filters, fte_klassen: Array.from(set) as FteKlasse[] });
  }

  function handlePickCenter(c: LatLng) {
    onChange({ ...filters, regio_center: c });
  }

  function handleResetCenter() {
    onChange({ ...filters, regio_center: null });
  }

  const fteLabel =
    filters.fte_klassen.length === FTE_OPTIONS.length
      ? "Alle groottes"
      : filters.fte_klassen.length === 0
      ? "Geen geselecteerd"
      : filters.fte_klassen.join(", ");

  return (
    <div className="space-y-5 rounded-lg border border-pavo-gray-100 bg-white p-4 shadow-sm md:p-5">
      {/* Compacte filter-rij */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        <div className="md:col-span-3">
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
              <div className="absolute z-[1100] mt-1 w-full rounded-lg border border-pavo-gray-100 bg-white p-2 shadow-md">
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

        <div className="md:col-span-4">
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

        <div className="flex items-end md:col-span-2">
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

      {/* Regio-sectie met kaart */}
      <div>
        <div className="mb-1.5 flex flex-col gap-0.5 md:flex-row md:items-baseline md:justify-between md:gap-4">
          <label className="text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
            Regio
          </label>
          <span className="text-xs text-pavo-gray-600">
            {filters.regio_center
              ? `Pin op ${filters.regio_center.lat.toFixed(3)}°N, ${filters.regio_center.lng.toFixed(3)}°E`
              : "Klik op de kaart om een middelpunt te kiezen — of laat leeg voor heel NL"}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className="md:col-span-8">
            <div className="relative h-[260px] overflow-hidden rounded-lg border border-pavo-gray-100 md:h-[320px]">
              <MapPicker
                center={filters.regio_center}
                radiusKm={filters.regio_straal_km}
                onPick={handlePickCenter}
              />
            </div>
          </div>

          <div className="flex flex-col gap-4 md:col-span-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
                Straal
              </label>
              <div className="flex items-center gap-3">
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
                <span className="w-16 text-right text-sm tabular-nums text-pavo-gray-900">
                  {filters.regio_straal_km} km
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleResetCenter}
              disabled={!filters.regio_center}
              className="w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 transition-all duration-200 hover:border-pavo-teal hover:text-pavo-teal disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset pin
            </button>

            <p className="text-xs leading-relaxed text-pavo-gray-600">
              De agent beperkt zich tot bedrijven binnen deze straal. Geen pin
              = heel Nederland.
            </p>

            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
                Max basisprofielen
              </label>
              <input
                type="number"
                min={10}
                max={500}
                step={10}
                value={filters.max_basisprofielen ?? 200}
                onChange={(e) =>
                  onChange({
                    ...filters,
                    max_basisprofielen: Number(e.target.value) || 200,
                  })
                }
                className="w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 transition-all duration-200 hover:border-pavo-teal focus:border-pavo-teal focus:outline-none"
              />
              <p className="mt-1 text-xs leading-relaxed text-pavo-gray-600">
                Hard cap op betaalde KvK-calls per zoekopdracht (€0,02
                per call). Default 200 = €4. Verlaag voor goedkoper, of
                verhoog voor bredere coverage.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
