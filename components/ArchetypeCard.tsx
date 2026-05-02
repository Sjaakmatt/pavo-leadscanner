import type { Archetype } from "@/lib/adapters/types";

export default function ArchetypeCard({
  archetype,
}: {
  archetype: Archetype | null;
}) {
  if (!archetype) {
    return (
      <section className="rounded-2xl border border-pavo-ink/[0.06] bg-white/60 p-5 shadow-card md:p-6">
        <div className="flex items-center gap-2.5">
          <CardIcon />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pavo-gray-600">
            Archetype
          </h2>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-pavo-gray-600">
          Geen significant HR-archetype herkend — bedrijf vertoont geen van de
          geanalyseerde patronen.
        </p>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-pavo-navy/15 bg-gradient-to-br from-pavo-navy via-pavo-navy-soft to-pavo-teal-dark p-6 text-white shadow-card-lg md:p-8">
      {/* Subtle decoratieve sterren */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.18) 1px, transparent 1.5px), radial-gradient(circle at 80% 60%, rgba(255,255,255,0.12) 1px, transparent 1.5px), radial-gradient(circle at 50% 90%, rgba(255,255,255,0.10) 1px, transparent 1.5px)",
          backgroundSize: "120px 120px, 90px 90px, 60px 60px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-pavo-teal-bright/30 blur-3xl"
      />

      <div className="relative flex items-center gap-2.5">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20 backdrop-blur">
          <CompassIcon className="h-3.5 w-3.5 text-white" />
        </span>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pavo-mint">
          Archetype
        </h2>
      </div>
      <h3 className="relative mt-4 text-2xl font-semibold leading-tight tracking-tight md:text-[28px]">
        {archetype.naam}
      </h3>
      <p className="relative mt-3 text-[15px] leading-relaxed text-white/80 md:text-base">
        {archetype.beschrijving}
      </p>
    </section>
  );
}

function CardIcon() {
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-pavo-frost text-pavo-gray-600">
      <CompassIcon className="h-3.5 w-3.5" />
    </span>
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
