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

const COLOR: Record<LeadStatus, string> = {
  nieuw: "bg-pavo-gray-100 text-pavo-gray-900",
  shortlist: "bg-pavo-teal/10 text-pavo-teal",
  benaderd: "bg-pavo-teal/15 text-pavo-teal",
  gesprek: "bg-pavo-orange/15 text-pavo-orange",
  gewonnen: "bg-emerald-100 text-emerald-800",
  verloren: "bg-pavo-gray-200 text-pavo-gray-600",
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
    <section className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm md:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
          Lead-status
        </h2>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${COLOR[current]}`}
        >
          {LABELS[current]}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {LEAD_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => update(s)}
            disabled={saving || s === current}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              s === current
                ? "border-pavo-teal bg-pavo-teal text-white"
                : "border-pavo-gray-100 bg-white text-pavo-gray-900 hover:border-pavo-teal hover:text-pavo-teal disabled:opacity-50"
            }`}
          >
            {LABELS[s]}
          </button>
        ))}
      </div>

      <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
        Reden / notitie (optioneel)
      </label>
      <textarea
        value={reden}
        onChange={(e) => setReden(e.target.value)}
        rows={2}
        placeholder="bv. 'Geen budget tot Q3' of 'CTO is oud-collega van Roy'"
        className="mt-1.5 w-full resize-none rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 placeholder:text-pavo-gray-600/60 focus:border-pavo-teal focus:outline-none"
      />
    </section>
  );
}
