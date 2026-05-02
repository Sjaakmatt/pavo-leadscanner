import type { Warmte } from "@/lib/adapters/types";

const STYLES: Record<Warmte, string> = {
  HOT: "bg-gradient-to-br from-pavo-coral to-pavo-orange text-white shadow-[0_4px_12px_-2px_rgba(232,117,68,0.45)] ring-1 ring-pavo-orange/40",
  WARM: "bg-gradient-to-br from-[#FCEBA8] to-[#F5D875] text-[#6B4E0A] ring-1 ring-amber-400/30",
  COLD: "bg-pavo-frost text-pavo-gray-600 ring-1 ring-pavo-gray-100",
};

const DOT: Record<Warmte, string> = {
  HOT: "bg-white",
  WARM: "bg-[#7C5E0E]/70",
  COLD: "bg-pavo-gray-600/60",
};

export default function WarmteBadge({
  warmte,
  className = "",
}: {
  warmte: Warmte;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${STYLES[warmte]} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[warmte]}`} />
      {warmte}
    </span>
  );
}
