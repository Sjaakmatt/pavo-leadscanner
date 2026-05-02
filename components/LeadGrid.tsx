import type { Lead } from "@/lib/adapters/types";
import LeadCard from "./LeadCard";

type Props = {
  leads: Lead[];
  selected?: string[];
  onToggleSelect?: (kvk: string) => void;
};

export default function LeadGrid({ leads, selected, onToggleSelect }: Props) {
  if (leads.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-pavo-ink/[0.10] bg-white/40 p-10 text-center">
        <p className="text-sm text-pavo-gray-600">
          Geen leads gevonden voor deze combinatie van filters.
        </p>
      </div>
    );
  }

  const actionable = leads.filter((l) => l.warmte !== "COLD");
  const cold = leads.filter((l) => l.warmte === "COLD");
  const isSelected = (kvk: string) => selected?.includes(kvk) ?? false;

  return (
    <div className="space-y-10">
      {actionable.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {actionable.map((lead, i) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              index={i}
              selected={isSelected(lead.kvk)}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}

      {cold.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-px flex-1 bg-pavo-ink/[0.08]" />
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-pavo-gray-600">
              Ook onderzocht — geen relevante HR-signalen ({cold.length})
            </h2>
            <span className="h-px flex-1 bg-pavo-ink/[0.08]" />
          </div>
          <div className="space-y-1.5">
            {cold.map((lead, i) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                index={actionable.length + i}
                selected={isSelected(lead.kvk)}
                onToggleSelect={onToggleSelect}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
