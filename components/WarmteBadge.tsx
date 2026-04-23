import type { Warmte } from "@/lib/adapters/types";

const STYLES: Record<Warmte, string> = {
  HOT: "bg-pavo-orange text-white",
  WARM: "bg-[#F5E6A8] text-[#7C5E0E]",
  COLD: "bg-pavo-gray-100 text-[#495057]",
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
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${STYLES[warmte]} ${className}`}
    >
      {warmte}
    </span>
  );
}
