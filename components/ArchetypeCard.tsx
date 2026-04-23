import type { Archetype } from "@/lib/adapters/types";

export default function ArchetypeCard({
  archetype,
}: {
  archetype: Archetype | null;
}) {
  return (
    <section className="rounded-lg border border-pavo-gray-100 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <CompassIcon className="h-4 w-4 text-pavo-teal" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
          Archetype
        </h2>
      </div>

      {archetype ? (
        <>
          <h3 className="mt-3 text-xl font-semibold text-pavo-navy">
            {archetype.naam}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-pavo-gray-900">
            {archetype.beschrijving}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-pavo-gray-600">
          Geen significant HR-archetype herkend — bedrijf vertoont geen van de
          geanalyseerde patronen.
        </p>
      )}
    </section>
  );
}

function CompassIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
      aria-hidden
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="m12.5 7.5-3.2 1.3-1.3 3.2 3.2-1.3z" fill="currentColor" />
    </svg>
  );
}
