"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { Lead } from "@/lib/adapters/types";
import WarmteBadge from "./WarmteBadge";

type Props = {
  lead: Lead;
  index: number;
};

// Dispatch per warmte: HOT gets the full rich card, WARM drops the
// dienst-bars and keeps one signal, COLD collapses to a single line
// stating the lead was checked but showed no HR-signals. Three
// visually distinct states so the grid communicates urgency at a
// glance instead of showing "precies hetzelfde" in three colors.
export default function LeadCard({ lead, index }: Props) {
  const commonMotion = {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.25,
      delay: index * 0.05,
      ease: "easeOut" as const,
    },
  };

  if (lead.warmte === "COLD") {
    return (
      <motion.div {...commonMotion} className="h-full">
        <ColdCard lead={lead} />
      </motion.div>
    );
  }

  if (lead.warmte === "WARM") {
    return (
      <motion.div {...commonMotion} className="h-full">
        <WarmCard lead={lead} />
      </motion.div>
    );
  }

  return (
    <motion.div {...commonMotion} className="h-full">
      <HotCard lead={lead} />
    </motion.div>
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
      className="group flex h-full flex-col rounded-lg border border-pavo-gray-100 border-l-4 border-l-pavo-orange bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
    >
      <CardHeader lead={lead} />

      {lead.archetype && (
        <div className="mt-4 flex items-start gap-2">
          <TargetIcon className="mt-0.5 h-4 w-4 shrink-0 text-pavo-teal" />
          <p className="text-sm font-medium leading-snug text-pavo-teal">
            {lead.archetype.naam}
          </p>
        </div>
      )}

      {topSignaal && (
        <blockquote className="mt-3 border-l-2 border-pavo-gray-100 pl-3 text-xs italic leading-relaxed text-pavo-gray-600">
          &ldquo;{topSignaal.tekst}&rdquo;
        </blockquote>
      )}

      {primaireDiensten.length > 0 && (
        <div className="mt-4 space-y-2.5">
          {primaireDiensten.map((d) => (
            <div key={d.code}>
              <div className="mb-1 flex items-center gap-2 text-xs">
                <span className="inline-flex min-w-[28px] justify-center rounded bg-pavo-teal/10 px-1.5 py-0.5 font-semibold text-pavo-teal">
                  {d.code}
                </span>
                <span className="flex-1 truncate text-pavo-gray-900">
                  {d.naam}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-pavo-navy">
                  {d.score}%
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-pavo-gray-100">
                <div
                  className="h-full rounded-full bg-pavo-teal"
                  style={{ width: `${d.score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-pavo-gray-100 pt-3 text-xs">
        <span className="text-pavo-gray-600">
          {lead.signalen.length}{" "}
          {lead.signalen.length === 1 ? "signaal" : "signalen"}
        </span>
        <span className="font-medium text-pavo-teal transition-transform duration-200 group-hover:translate-x-0.5">
          Bekijk uitleg →
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
      className="group flex h-full flex-col rounded-lg border border-pavo-gray-100 border-l-4 border-l-[#E3C35C] bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
    >
      <CardHeader lead={lead} />

      {lead.archetype && (
        <p className="mt-4 text-sm font-medium text-pavo-navy">
          {lead.archetype.naam}
        </p>
      )}

      {topSignaal && (
        <blockquote className="mt-2 text-xs leading-relaxed text-pavo-gray-600">
          {topSignaal.tekst}
        </blockquote>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-pavo-gray-100 pt-3 text-xs">
        <span className="text-pavo-gray-600">
          {lead.signalen.length}{" "}
          {lead.signalen.length === 1 ? "signaal" : "signalen"}
        </span>
        <span className="font-medium text-pavo-teal transition-transform duration-200 group-hover:translate-x-0.5">
          Bekijk uitleg →
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
      className="group flex h-full items-center justify-between gap-3 rounded-lg border border-pavo-gray-100 border-l-4 border-l-pavo-gray-100 bg-pavo-gray-50/50 px-4 py-3 text-sm transition-all duration-200 hover:bg-white hover:shadow-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="truncate font-medium text-pavo-gray-900">
            {lead.naam}
          </h3>
          <span className="shrink-0 text-xs text-pavo-gray-600">
            {lead.plaats}
          </span>
        </div>
        <p className="truncate text-xs text-pavo-gray-600">
          {reden ?? "Onderzocht · geen relevante HR-signalen"}
        </p>
      </div>
      <WarmteBadge warmte={lead.warmte} className="shrink-0" />
    </Link>
  );
}

function CardHeader({ lead }: { lead: Lead }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-lg font-semibold leading-tight text-pavo-navy">
          {lead.naam}
        </h3>
        <p className="mt-1 text-xs text-pavo-gray-600">
          {lead.plaats} · {lead.fte_klasse} FTE · {shortSector(lead.sector)}
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
