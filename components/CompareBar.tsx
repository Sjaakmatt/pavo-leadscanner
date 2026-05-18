"use client";

import Link from "next/link";

type Props = {
  selected: string[];
  onClear: () => void;
  onRemove: (kvk: string) => void;
};

// Sticky floating bar onderaan de viewport zodra de gebruiker
// 1+ leads heeft toegevoegd aan vergelijking. "Vergelijken" linkt naar
// /compare?kvks=A,B,C zodra er minimaal 2 zijn.
export default function CompareBar({ selected, onClear, onRemove }: Props) {
  if (selected.length === 0) return null;
  const canCompare = selected.length >= 2;
  const href = canCompare ? `/compare?kvks=${selected.join(",")}` : "#";
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
      <div className="pointer-events-auto flex max-w-3xl items-center gap-3 rounded-lg border border-pavo-teal/30 bg-white px-4 py-3 shadow-lg">
        <span className="text-xs text-pavo-gray-600">
          {selected.length} {selected.length === 1 ? "lead" : "leads"} geselecteerd
        </span>
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((k) => (
            <li
              key={k}
              className="inline-flex items-center gap-1 rounded bg-pavo-teal/10 px-2 py-0.5 text-[11px] text-pavo-teal"
            >
              {k}
              <button
                type="button"
                onClick={() => onRemove(k)}
                className="hover:text-pavo-teal-dark"
                aria-label={`Verwijder ${k}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-pavo-gray-600 hover:text-pavo-orange"
        >
          Reset
        </button>
        <Link
          href={href}
          aria-disabled={!canCompare}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
            canCompare
              ? "bg-pavo-teal text-white hover:bg-pavo-teal-dark"
              : "cursor-not-allowed bg-pavo-gray-100 text-pavo-gray-600"
          }`}
        >
          Vergelijken
        </Link>
      </div>
    </div>
  );
}
