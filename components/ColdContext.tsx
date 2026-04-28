import type { Lead } from "@/lib/adapters/types";

// Toont de "waarom NIET"-context voor COLD leads. Alleen relevant
// wanneer warmte === "COLD" en cold_redenen niet leeg is. Anders
// renderen we niets — de archetype/signalen-secties dekken HOT/WARM.

export default function ColdContext({ lead }: { lead: Lead }) {
  if (lead.warmte !== "COLD") return null;
  const redenen = lead.cold_redenen ?? [];
  if (redenen.length === 0) return null;

  return (
    <section className="rounded-lg border border-pavo-gray-100 bg-pavo-gray-50/40 p-5 md:p-6">
      <div className="flex items-center gap-2">
        <InfoIcon className="h-4 w-4 text-pavo-gray-600" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
          Waarom deze lead COLD is
        </h2>
      </div>
      <p className="mt-2 text-sm text-pavo-gray-600">
        De agent heeft alle bronnen gecheckt. Geen of onvoldoende
        signalen voor warmte HOT/WARM:
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-pavo-gray-900">
        {redenen.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span
              aria-hidden
              className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-pavo-gray-100"
            />
            <span className="min-w-0 flex-1">{r}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InfoIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 13V9M10 6.5h.01" />
    </svg>
  );
}
