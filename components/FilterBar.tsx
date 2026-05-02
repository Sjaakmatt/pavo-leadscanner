"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { FteKlasse, LatLng, SearchFilters } from "@/lib/adapters/types";
import { BRANCHE_OPTIONS, FTE_OPTIONS } from "@/lib/filter";

// Leaflet touches `window` at import time, so the map must be client-only.
const MapPicker = dynamic(() => import("./MapPicker"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-pavo-frost text-sm text-pavo-gray-600">
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
  const fteRef = useRef<HTMLDivElement>(null);

  // Sluit de dropdown wanneer er buiten geklikt wordt — anders blijft 'ie
  // achter andere UI hangen en voelt het rommelig.
  useEffect(() => {
    if (!fteOpen) return;
    function onDoc(e: MouseEvent) {
      if (!fteRef.current?.contains(e.target as Node)) setFteOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [fteOpen]);

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
      : filters.fte_klassen.length <= 2
      ? filters.fte_klassen.join(", ")
      : `${filters.fte_klassen.length} groottes`;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-pavo-ink/[0.06] bg-white/80 p-5 shadow-card backdrop-blur-sm md:p-6">
      {/* Subtle top-edge gradient streep — gooit een beetje brand-color
          in een verder neutrale card */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-pavo-teal/30 to-transparent"
      />

      {/* Compacte filter-rij */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-12 md:gap-3">
        <Field label="Bedrijfsomvang" cols="md:col-span-3">
          <div className="relative" ref={fteRef}>
            <button
              type="button"
              onClick={() => setFteOpen((v) => !v)}
              className="group flex w-full items-center justify-between gap-2 rounded-xl border border-pavo-ink/[0.08] bg-white px-3.5 py-2.5 text-left text-sm font-medium text-pavo-navy transition-all duration-200 hover:border-pavo-teal/40 focus:border-pavo-teal focus:outline-none focus:ring-4 focus:ring-pavo-teal/10"
              aria-expanded={fteOpen}
            >
              <span className="truncate">{fteLabel}</span>
              <ChevronIcon
                className={`h-4 w-4 shrink-0 text-pavo-gray-600 transition-transform duration-200 ${
                  fteOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {fteOpen && (
              <div className="absolute z-[1100] mt-2 w-full overflow-hidden rounded-xl border border-pavo-ink/[0.08] bg-white p-1.5 shadow-card-lg">
                {FTE_OPTIONS.map((opt) => {
                  const checked = filters.fte_klassen.includes(opt);
                  return (
                    <label
                      key={opt}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-pavo-navy transition-colors hover:bg-pavo-frost/60"
                    >
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded border-2 transition-colors ${
                          checked
                            ? "border-pavo-teal bg-pavo-teal"
                            : "border-pavo-gray-200 bg-white"
                        }`}
                      >
                        {checked && (
                          <CheckIcon className="h-2.5 w-2.5 text-white" />
                        )}
                      </span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleFte(opt)}
                        className="sr-only"
                      />
                      {opt} FTE
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </Field>

        <Field label="Branche" cols="md:col-span-3">
          <div className="relative">
            <select
              value={filters.branche}
              onChange={(e) => onChange({ ...filters, branche: e.target.value })}
              className="w-full appearance-none rounded-xl border border-pavo-ink/[0.08] bg-white px-3.5 py-2.5 pr-9 text-sm font-medium text-pavo-navy transition-all duration-200 hover:border-pavo-teal/40 focus:border-pavo-teal focus:outline-none focus:ring-4 focus:ring-pavo-teal/10"
            >
              {BRANCHE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <ChevronIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pavo-gray-600" />
          </div>
        </Field>

        <Field label="Bijzondere signalen" cols="md:col-span-4">
          <div className="relative">
            <SignalIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pavo-gray-600" />
            <input
              type="text"
              value={filters.signaal_query}
              onChange={(e) =>
                onChange({ ...filters, signaal_query: e.target.value })
              }
              placeholder="bv. 'hoog verloop', 'net over 50 FTE'"
              className="w-full rounded-xl border border-pavo-ink/[0.08] bg-white py-2.5 pl-9 pr-3 text-sm font-medium text-pavo-navy transition-all duration-200 placeholder:font-normal placeholder:text-pavo-gray-600/70 hover:border-pavo-teal/40 focus:border-pavo-teal focus:outline-none focus:ring-4 focus:ring-pavo-teal/10"
            />
          </div>
        </Field>

        <div className="flex items-end md:col-span-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={loading || filters.fte_klassen.length === 0}
            className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-br from-pavo-orange to-pavo-coral px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 glow-orange hover:from-pavo-coral hover:to-pavo-orange disabled:cursor-not-allowed disabled:from-pavo-gray-100 disabled:to-pavo-gray-100 disabled:text-pavo-gray-600 disabled:shadow-none"
          >
            {loading ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-white/30 border-t-white" />
                <span>Zoekt…</span>
              </>
            ) : (
              <>
                <SparkleIcon className="h-4 w-4 transition-transform duration-300 group-hover:rotate-12 group-disabled:hidden" />
                <span>Zoek leads</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Regio-sectie met kaart */}
      <div className="mt-6 border-t border-pavo-ink/[0.06] pt-5">
        <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-4">
          <div className="flex items-center gap-2">
            <PinIcon className="h-3.5 w-3.5 text-pavo-teal" />
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-pavo-gray-600">
              Regio
            </h3>
          </div>
          <span className="text-xs text-pavo-gray-600">
            {filters.regio_center ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-pavo-teal/[0.08] px-2 py-0.5 font-mono text-[11px] font-medium text-pavo-teal">
                <span className="h-1.5 w-1.5 rounded-full bg-pavo-teal" />
                {filters.regio_center.lat.toFixed(3)}°N,{" "}
                {filters.regio_center.lng.toFixed(3)}°E
              </span>
            ) : (
              "Klik op de kaart om een middelpunt te kiezen — of laat leeg voor heel NL"
            )}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className="md:col-span-8">
            <div className="relative h-[260px] overflow-hidden rounded-2xl border border-pavo-ink/[0.06] shadow-card md:h-[320px]">
              <MapPicker
                center={filters.regio_center}
                radiusKm={filters.regio_straal_km}
                onPick={handlePickCenter}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3.5 md:col-span-4">
            <div className="rounded-2xl border border-pavo-ink/[0.06] bg-pavo-frost/40 p-4">
              <label className="mb-2.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-pavo-gray-600">
                <span>Straal</span>
                <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] font-bold text-pavo-navy ring-1 ring-pavo-ink/[0.06]">
                  {filters.regio_straal_km} km
                </span>
              </label>
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
                className="w-full accent-pavo-teal"
              />
              <div className="mt-1 flex justify-between text-[10px] text-pavo-gray-600">
                <span>5</span>
                <span>100</span>
                <span>200</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleResetCenter}
              disabled={!filters.regio_center}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-pavo-ink/[0.08] bg-white px-3 py-2 text-xs font-semibold text-pavo-navy transition-all duration-200 hover:border-pavo-teal/40 hover:text-pavo-teal disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ResetIcon className="h-3.5 w-3.5" />
              Reset pin
            </button>

            <div className="rounded-2xl border border-pavo-ink/[0.06] bg-pavo-frost/40 p-4">
              <label className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-pavo-gray-600">
                <span>Max basisprofielen</span>
                <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] font-bold text-pavo-navy ring-1 ring-pavo-ink/[0.06]">
                  €{((filters.max_basisprofielen ?? 200) * 0.02).toFixed(0)}
                </span>
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
                className="w-full rounded-lg border border-pavo-ink/[0.08] bg-white px-3 py-1.5 text-sm font-medium text-pavo-navy transition-all duration-200 hover:border-pavo-teal/40 focus:border-pavo-teal focus:outline-none focus:ring-4 focus:ring-pavo-teal/10"
              />
              <p className="mt-2 text-[11px] leading-relaxed text-pavo-gray-600">
                Hard cap op betaalde KvK-calls (€0,02 per call). Default 200 = €4.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  cols,
  children,
}: {
  label: string;
  cols: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cols}>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-pavo-gray-600">
        {label}
      </label>
      {children}
    </div>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 10.5 8 14.5 16 6" />
    </svg>
  );
}

function SignalIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="10" cy="10" r="2" />
      <path d="M5 10a5 5 0 0 1 5-5M15 10a5 5 0 0 1-5 5" />
      <path d="M3 10a7 7 0 0 1 7-7M17 10a7 7 0 0 1-7 7" />
    </svg>
  );
}

function SparkleIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M10 1.5l1.4 4.2 4.2 1.4-4.2 1.4L10 12.7l-1.4-4.2L4.4 7.1 8.6 5.7 10 1.5zM15.5 12l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2zM4.5 13l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5L2.5 15l1.5-.5.5-1.5z" />
    </svg>
  );
}

function PinIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M10 1.5c-3 0-5.5 2.4-5.5 5.4 0 4 5.5 11.6 5.5 11.6S15.5 11 15.5 7c0-3-2.5-5.5-5.5-5.5zm0 7.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" />
    </svg>
  );
}

function ResetIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 10a7 7 0 1 0 2-5" />
      <path d="M3 4v3.5h3.5" />
    </svg>
  );
}
