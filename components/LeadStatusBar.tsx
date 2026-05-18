"use client";

import { useEffect, useState } from "react";
import {
  LEAD_STATUSES,
  type LeadStatus,
  type LeadStatusRow,
} from "@/lib/lead-status/types";

type Props = {
  kvk: string;
};

const LABELS: Record<LeadStatus, string> = {
  nieuw: "Nieuw",
  shortlist: "Shortlist",
  benaderd: "Benaderd",
  gesprek: "Gesprek",
  gewonnen: "Gewonnen",
  verloren: "Verloren",
};

const ACTIVE: Record<LeadStatus, string> = {
  nieuw:
    "border-pavo-gray-200 bg-pavo-gray-100 text-pavo-navy ring-1 ring-pavo-gray-200/60",
  shortlist:
    "border-pavo-teal bg-gradient-to-br from-pavo-teal to-pavo-navy text-white shadow-[0_4px_12px_-4px_rgba(15,62,71,0.5)]",
  benaderd:
    "border-pavo-teal-bright bg-gradient-to-br from-pavo-teal-bright to-pavo-teal text-white shadow-[0_4px_12px_-4px_rgba(42,143,163,0.5)]",
  gesprek:
    "border-pavo-orange bg-gradient-to-br from-pavo-orange to-pavo-coral text-white shadow-[0_4px_12px_-4px_rgba(232,117,68,0.5)]",
  gewonnen:
    "border-emerald-500 bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-[0_4px_12px_-4px_rgba(16,185,129,0.5)]",
  verloren:
    "border-pavo-gray-200 bg-pavo-gray-200 text-pavo-gray-600 ring-1 ring-pavo-gray-200/60",
};

export default function LeadStatusBar({ kvk }: Props) {
  const [current, setCurrent] = useState<LeadStatus>("nieuw");
  const [reden, setReden] = useState("");
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/lead-status/${kvk}`);
        if (res.status === 503) {
          if (!cancelled) setAvailable(false);
          return;
        }
        const data = (await res.json()) as { status: LeadStatusRow | null };
        if (cancelled) return;
        if (data.status) {
          setCurrent(data.status.status);
          setReden(data.status.reden ?? "");
        }
      } catch {
        // silent — feature degraderd
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kvk]);

  async function update(next: LeadStatus) {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/lead-status/${kvk}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, reden: reden.trim() || null }),
      });
      if (res.ok) setCurrent(next);
    } finally {
      setSaving(false);
    }
  }

  if (!available) return null;

  return (
    <section className="rounded-2xl border border-pavo-ink/[0.06] bg-white p-5 shadow-card md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-pavo-frost text-pavo-gray-600">
            <FlagIcon className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pavo-gray-600">
            Lead-status
          </h2>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {LEAD_STATUSES.map((s) => {
          const isActive = s === current;
          return (
            <button
              key={s}
              type="button"
              onClick={() => update(s)}
              disabled={saving || isActive}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                isActive
                  ? ACTIVE[s]
                  : "border-pavo-ink/[0.08] bg-white text-pavo-navy hover:border-pavo-teal/40 hover:text-pavo-teal disabled:opacity-50"
              }`}
            >
              {LABELS[s]}
            </button>
          );
        })}
      </div>

      <label className="mt-5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-pavo-gray-600">
        Reden / notitie (optioneel)
      </label>
      <textarea
        value={reden}
        onChange={(e) => setReden(e.target.value)}
        rows={2}
        placeholder="bv. 'Geen budget tot Q3' of 'CTO is oud-collega van Roy'"
        className="mt-2 w-full resize-none rounded-xl border border-pavo-ink/[0.08] bg-white px-3.5 py-2.5 text-sm text-pavo-navy placeholder:text-pavo-gray-600/60 focus:border-pavo-teal focus:outline-none focus:ring-4 focus:ring-pavo-teal/10"
      />
    </section>
  );
}

function FlagIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M5 17V3" />
      <path d="M5 4h9l-1.5 3.5L14 11H5" />
    </svg>
  );
}
