"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Lead } from "@/lib/adapters/types";
import WarmteBadge from "@/components/WarmteBadge";

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 py-10">
          <div className="h-8 w-48 animate-pulse rounded bg-pavo-gray-100" />
        </div>
      }
    >
      <CompareInner />
    </Suspense>
  );
}

function CompareInner() {
  const params = useSearchParams();
  const kvks = (params.get("kvks") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (kvks.length < 2) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kvks }),
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          if (!cancelled) setError(body.error ?? `status ${res.status}`);
          return;
        }
        const body = (await res.json()) as { leads: Lead[] };
        if (!cancelled) setLeads(body.leads);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kvks.join(",")]);

  if (kvks.length < 2) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-pavo-navy">Vergelijken</h1>
        <p className="mt-3 text-sm text-pavo-gray-600">
          Selecteer minimaal 2 leads in de resultaten via de checkbox en
          klik op "Vergelijken".
        </p>
        <Link
          href="/"
          className="mt-4 inline-block text-sm text-pavo-teal hover:underline"
        >
          ← terug naar zoeken
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-pavo-navy">Vergelijken</h1>
        <p className="mt-3 text-sm text-pavo-orange">Fout: {error}</p>
      </div>
    );
  }

  if (!leads) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="h-8 w-48 animate-pulse rounded bg-pavo-gray-100" />
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          {kvks.map((k) => (
            <div
              key={k}
              className="h-64 animate-pulse rounded-lg bg-pavo-gray-100"
            />
          ))}
        </div>
      </div>
    );
  }

  // Verzamel alle dienst-codes die in een van de leads voorkomen
  // zodat de tabel een vaste rij-volgorde heeft.
  const allDienstCodes = Array.from(
    new Set(leads.flatMap((l) => l.diensten.map((d) => d.code))),
  ).sort();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-pavo-navy md:text-3xl">
            Vergelijken
          </h1>
          <p className="mt-1 text-sm text-pavo-gray-600">
            {leads.length} leads naast elkaar — sterkere score is groter.
          </p>
        </div>
        <Link
          href="/"
          className="text-sm text-pavo-teal hover:underline"
        >
          ← terug
        </Link>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-pavo-gray-100 bg-white shadow-sm">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="border-b border-pavo-gray-100 bg-pavo-gray-50/40 text-xs text-pavo-gray-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Attribuut</th>
              {leads.map((l) => (
                <th
                  key={l.kvk}
                  className="px-3 py-2 text-left font-medium"
                >
                  <Link
                    href={`/lead/${l.kvk}`}
                    className="hover:text-pavo-teal"
                  >
                    {l.naam}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row label="Plaats" cells={leads.map((l) => l.plaats || "—")} />
            <Row
              label="FTE-klasse"
              cells={leads.map((l) => l.fte_klasse)}
            />
            <Row
              label="Warmte"
              cells={leads.map((l) => (
                <WarmteBadge key={l.kvk} warmte={l.warmte} />
              ))}
            />
            <Row
              label="Archetype"
              cells={leads.map((l) => l.archetype?.naam ?? "—")}
            />
            <Row
              label="Aantal signalen"
              cells={leads.map((l) => l.signalen.length.toString())}
            />
            <Row
              label="Top-dienst"
              cells={leads.map((l) => {
                const top = l.diensten[0];
                return top ? `${top.code} — ${top.naam} (${top.score}%)` : "—";
              })}
            />

            <tr>
              <td
                colSpan={leads.length + 1}
                className="border-t border-pavo-gray-100 bg-pavo-gray-50/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600"
              >
                Dienst-scores
              </td>
            </tr>
            {allDienstCodes.map((code) => (
              <tr
                key={code}
                className="border-t border-pavo-gray-100/70"
              >
                <td className="px-3 py-2 font-medium text-pavo-gray-900">
                  {code}
                </td>
                {leads.map((l) => {
                  const d = l.diensten.find((x) => x.code === code);
                  return (
                    <td key={l.kvk} className="px-3 py-2">
                      {d ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-pavo-gray-100">
                            <div
                              className="h-full rounded-full bg-pavo-teal"
                              style={{ width: `${d.score}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs tabular-nums text-pavo-gray-900">
                            {d.score}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-pavo-gray-600/70">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}

            <tr>
              <td
                colSpan={leads.length + 1}
                className="border-t border-pavo-gray-100 bg-pavo-gray-50/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600"
              >
                Top-signalen
              </td>
            </tr>
            <tr className="border-t border-pavo-gray-100/70">
              <td className="px-3 py-2 align-top text-xs text-pavo-gray-600">
                Eerste 3
              </td>
              {leads.map((l) => (
                <td
                  key={l.kvk}
                  className="px-3 py-2 align-top text-xs text-pavo-gray-900"
                >
                  <ul className="list-disc space-y-1 pl-4">
                    {l.signalen.slice(0, 3).map((s, i) => (
                      <li key={i}>{s.tekst}</li>
                    ))}
                    {l.signalen.length === 0 && <li>geen signalen</li>}
                  </ul>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  label,
  cells,
}: {
  label: string;
  cells: React.ReactNode[];
}) {
  return (
    <tr className="border-t border-pavo-gray-100/70">
      <td className="px-3 py-2 font-medium text-pavo-gray-900">{label}</td>
      {cells.map((cell, i) => (
        <td key={i} className="px-3 py-2 text-pavo-gray-900">
          {cell}
        </td>
      ))}
    </tr>
  );
}
