"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import FilterBar from "@/components/FilterBar";
import LeadGrid from "@/components/LeadGrid";
import StreamingStatus, { type StreamStep } from "@/components/StreamingStatus";
import type { Lead, SearchFilters } from "@/lib/adapters/types";
import { DEFAULT_FILTERS } from "@/lib/filter";

type ViewState =
  | { kind: "empty" }
  | { kind: "streaming"; steps: StreamStep[]; pendingLeads: Lead[] }
  | { kind: "results"; steps: StreamStep[]; leads: Lead[] };

export default function DashboardPage() {
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [view, setView] = useState<ViewState>({ kind: "empty" });
  const [loading, setLoading] = useState(false);

  async function handleSearch() {
    setLoading(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      });
      const data = (await res.json()) as {
        steps: StreamStep[];
        leads: Lead[];
      };
      setView({
        kind: "streaming",
        steps: data.steps,
        pendingLeads: data.leads,
      });
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  }

  function handleStreamingComplete() {
    setView((curr) => {
      if (curr.kind !== "streaming") return curr;
      return {
        kind: "results",
        steps: curr.steps,
        leads: curr.pendingLeads,
      };
    });
    setLoading(false);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10">
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-pavo-navy md:text-3xl">
          Onderzoek naar MKB-leads met HR-behoefte
        </h1>
        <p className="mt-2 text-sm text-pavo-gray-600">
          Stel filters in en laat de agent naar passende bedrijven zoeken
        </p>
      </div>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        onSubmit={handleSearch}
        loading={loading}
      />

      <div className="mt-8">
        <AnimatePresence mode="wait">
          {view.kind === "empty" && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="rounded-lg border border-dashed border-pavo-gray-100 bg-white p-8 text-center md:p-16"
            >
              <SearchGlassIcon className="mx-auto h-10 w-10 text-pavo-teal md:h-12 md:w-12" />
              <h2 className="mt-4 text-base font-semibold text-pavo-navy">
                Geen zoekopdracht gestart
              </h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-pavo-gray-600">
                Pas de filters hierboven aan en klik op &quot;Zoek leads&quot;
                om de research-agent te starten
              </p>
            </motion.div>
          )}

          {view.kind === "streaming" && (
            <motion.div
              key="streaming"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <StreamingStatus
                steps={view.steps}
                onComplete={handleStreamingComplete}
              />
            </motion.div>
          )}

          {view.kind === "results" && (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <StreamingStatus steps={view.steps} />
              <div>
                <div className="mb-3 text-sm text-pavo-gray-600">
                  {view.leads.length}{" "}
                  {view.leads.length === 1 ? "lead" : "leads"} gevonden
                </div>
                <LeadGrid leads={view.leads} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SearchGlassIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <circle cx="21" cy="21" r="13" />
      <path d="m30 30 10 10" />
    </svg>
  );
}
