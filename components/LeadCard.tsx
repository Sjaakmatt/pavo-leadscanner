"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { Lead } from "@/lib/adapters/types";
import WarmteBadge from "./WarmteBadge";

type Props = {
  lead: Lead;
  index: number;
  selected?: boolean;
  onToggleSelect?: (kvk: string) => void;
};

// Dispatch per warmte: HOT gets the full rich card, WARM drops the
// dienst-bars and keeps one signal, COLD collapses to a single line
// stating the lead was checked but showed no HR-signals. Three
// visually distinct states so the grid communicates urgency at a
// glance instead of showing "precies hetzelfde" in three colors.
export default function LeadCard({
  lead,
  index,
  selected,
  onToggleSelect,
}: Props) {
  const commonMotion = {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.3,
      delay: Math.min(index * 0.04, 0.4),
      ease: "easeOut" as const,
    },
  };

  const compareToggle = onToggleSelect ? (
    <CompareToggle
      kvk={lead.kvk}
      selected={!!selected}
      onToggle={onToggleSelect}
    />
  ) : null;

  if (lead.warmte === "COLD") {
    return (
      <motion.div {...commonMotion} className="relative">
        <ColdCard lead={lead} />
        {compareToggle}
      </motion.div>
    );
  }

  if (lead.warmte === "WARM") {
    return (
      <motion.div {...commonMotion} className="relative h-full">
        <WarmCard lead={lead} />
        {compareToggle}
      </motion.div>
    );
  }

  return (
    <motion.div {...commonMotion} className="relative h-full">
      <HotCard lead={lead} />
      {compareToggle}
    </motion.div>
  );
}

function CompareToggle({
  kvk,
  selected,
  onToggle,
}: {
  kvk: string;
  selected: boolean;
  onToggle: (kvk: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(kvk);
      }}
      title={selected ? "Verwijder uit vergelijking" : "Voeg toe aan vergelijking"}
      className={`absolute right-2.5 top-2.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold backdrop-blur-sm transition-all duration-200 ${
        selected
          ? "border-pavo-teal bg-gradient-to-br from-pavo-teal to-pavo-navy text-white shadow-[0_4px_12px_-4px_rgba(15,62,71,0.5)]"
          : "border-pavo-ink/[0.08] bg-white/85 text-pavo-gray-600 hover:border-pavo-teal/40 hover:text-pavo-teal"
      }`}
      aria-pressed={selected}
    >
      {selected ? "✓" : "+"}
    </button>
  );
}

function HotCard({ lead }: { lead: Lead }) {
  const primaireDiensten = lead.diensten
    .filter((d) => d.prioriteit === "primair")
    .slice(0, 2);
  const topSignaal = lead.signalen[0] ?? null;

  return (
    <Link
      href={`/lead/${lead.kvk}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-white p-5 transition-all duration-300 hover:-translate-y-1 hot-card hover:shadow-[0_4px_8px_rgba(232,117,68,0.16),0_24px_50px_-12px_rgba(232,117,68,0.30)]"
    >
      {/* Decoratieve flame-glow rechtsboven — alleen op hover prominent */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-gradient-to-br from-pavo-coral/30 to-pavo-orange/0 opacity-50 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
      />

      <div className="relative">
        <CardHeader lead={lead} />
      </div>

      {lead.archetype && (
        <div className="relative mt-4 flex items-start gap-2 rounded-xl bg-gradient-to-r from-pavo-orange/[0.08] to-transparent px-3 py-2">
          <TargetIcon className="mt-0.5 h-4 w-4 shrink-0 text-pavo-orange" />
          <p className="text-sm font-semibold leading-snug text-pavo-navy">
            {lead.archetype.naam}
          </p>
        </div>
      )}

      {topSignaal && (
        <blockquote className="relative mt-3 border-l-[3px] border-pavo-orange/40 pl-3 text-[13px] italic leading-relaxed text-pavo-gray-600">
          &ldquo;{topSignaal.tekst}&rdquo;
        </blockquote>
      )}

      {primaireDiensten.length > 0 && (
        <div className="relative mt-4 space-y-3">
          {primaireDiensten.map((d) => (
            <div key={d.code}>
              <div className="mb-1 flex items-center gap-2 text-xs">
                <span className="inline-flex min-w-[30px] justify-center rounded-md bg-pavo-teal/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-pavo-teal">
                  {d.code}
                </span>
                <span className="flex-1 truncate font-medium text-pavo-navy">
                  {d.naam}
                </span>
                <span className="shrink-0 font-bold tabular-nums text-pavo-navy">
                  {d.score}
                  <span className="text-[10px] text-pavo-gray-600">%</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-pavo-gray-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-pavo-teal to-pavo-teal-bright"
                  style={{ width: `${d.score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="relative mt-auto flex items-center justify-between border-t border-pavo-orange/10 pt-3 text-xs">
        <span className="inline-flex items-center gap-1.5 text-pavo-gray-600">
          <Dot className="h-1.5 w-1.5 text-pavo-orange" />
          {lead.signalen.length}{" "}
          {lead.signalen.length === 1 ? "signaal" : "signalen"}
        </span>
        <span className="inline-flex items-center gap-1 font-semibold text-pavo-orange transition-transform duration-200 group-hover:translate-x-0.5">
          Bekijk uitleg
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}

function WarmCard({ lead }: { lead: Lead }) {
  const topSignaal = lead.signalen[0] ?? null;

  return (
    <Link
      href={`/lead/${lead.kvk}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-pavo-ink/[0.06] bg-white p-5 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:border-amber-300/50 hover:shadow-card-lg"
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-amber-300 via-amber-400 to-amber-300"
      />

      <CardHeader lead={lead} />

      {lead.archetype && (
        <p className="mt-3 text-sm font-semibold text-pavo-navy">
          {lead.archetype.naam}
        </p>
      )}

      {topSignaal && (
        <blockquote className="mt-2 text-[13px] leading-relaxed text-pavo-gray-600">
          {topSignaal.tekst}
        </blockquote>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-pavo-ink/[0.05] pt-3 text-xs">
        <span className="inline-flex items-center gap-1.5 text-pavo-gray-600">
          <Dot className="h-1.5 w-1.5 text-amber-400" />
          {lead.signalen.length}{" "}
          {lead.signalen.length === 1 ? "signaal" : "signalen"}
        </span>
        <span className="inline-flex items-center gap-1 font-semibold text-pavo-teal transition-transform duration-200 group-hover:translate-x-0.5">
          Bekijk uitleg
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}

function ColdCard({ lead }: { lead: Lead }) {
  const reden = lead.cold_redenen?.[0];
  return (
    <Link
      href={`/lead/${lead.kvk}`}
      className="group flex items-center justify-between gap-3 rounded-xl border border-pavo-ink/[0.04] bg-white/40 px-4 py-2.5 text-sm transition-all duration-200 hover:border-pavo-ink/[0.08] hover:bg-white"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="truncate font-medium text-pavo-navy">{lead.naam}</h3>
          <span className="shrink-0 text-xs text-pavo-gray-600">
            {lead.plaats}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-pavo-gray-600">
          {reden ?? "Onderzocht · geen relevante HR-signalen"}
        </p>
      </div>
      <WarmteBadge warmte={lead.warmte} className="shrink-0" />
      <ArrowRight className="hidden h-3.5 w-3.5 shrink-0 text-pavo-gray-600 transition-transform duration-200 group-hover:translate-x-0.5 sm:block" />
    </Link>
  );
}

function CardHeader({ lead }: { lead: Lead }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-[17px] font-semibold leading-tight tracking-tight text-pavo-navy">
          {lead.naam}
        </h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-pavo-gray-600">
          <span>{lead.plaats}</span>
          <Dot className="h-1 w-1 text-pavo-gray-200" />
          <span className="font-medium text-pavo-navy">{lead.fte_klasse} FTE</span>
          <Dot className="h-1 w-1 text-pavo-gray-200" />
          <span className="truncate">{shortSector(lead.sector)}</span>
        </p>
      </div>
      <WarmteBadge warmte={lead.warmte} />
    </div>
  );
}

// "Elektrotechnische installatie (SBI 43211)" -> "Elektrotechnische installatie"
function shortSector(sector: string): string {
  return sector.replace(/\s*\(SBI\s+\d+\)\s*$/, "").trim();
}

function TargetIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
      aria-hidden
    >
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="3.5" />
      <circle cx="10" cy="10" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ArrowRight({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 10h12M11 5l5 5-5 5" />
    </svg>
  );
}

function Dot({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 8 8" className={className} aria-hidden>
      <circle cx="4" cy="4" r="3" fill="currentColor" />
    </svg>
  );
}
