import type { Lead } from "@/lib/adapters/types";
import LeadCard from "./LeadCard";

export default function LeadGrid({ leads }: { leads: Lead[] }) {
  if (leads.length === 0) {
    return (
      <div className="rounded-lg border border-pavo-gray-100 bg-white p-10 text-center shadow-sm">
        <p className="text-sm text-pavo-gray-600">
          Geen leads gevonden voor deze combinatie van filters.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {leads.map((lead, i) => (
        <LeadCard key={lead.id} lead={lead} index={i} />
      ))}
    </div>
  );
}
