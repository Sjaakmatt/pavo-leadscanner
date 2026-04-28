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
      <div className="rounded-lg border border-pavo-gray-100 bg-white p-10 text-center shadow-sm">
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
    <div className="space-y-8">
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
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
            Ook onderzocht — geen relevante HR-signalen ({cold.length})
          </h2>
          <div className="space-y-2">
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
