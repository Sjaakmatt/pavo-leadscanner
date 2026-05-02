"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import FilterBar from "@/components/FilterBar";
import LeadGrid from "@/components/LeadGrid";
import SearchSummary from "@/components/SearchSummary";
import StreamingStatus, { type StreamStep } from "@/components/StreamingStatus";
import SavedSearchControls from "@/components/SavedSearchControls";
import ResultsToolbar, {
  type ResultFilters,
  type SortKey,
} from "@/components/ResultsToolbar";
import CompareBar from "@/components/CompareBar";
import type { FteKlasse, Lead, SearchFilters } from "@/lib/adapters/types";
import { DEFAULT_FILTERS } from "@/lib/filter";

// Leaflet touches window at import time — must be client-only.
const ResultsMap = dynamic(() => import("@/components/ResultsMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center rounded-2xl border border-pavo-ink/[0.06] bg-pavo-frost/60 text-sm text-pavo-gray-600">
      Kaart laden…
    </div>
  ),
});

type ResultsView = "lijst" | "kaart";

type Relaxation = { regio: boolean; fte: boolean };

// One "active" state covers streaming AND post-streaming: the
// StreamingStatus component mounts once per search and transitions
// itself from live-ticker to collapsed-summary. Splitting the state
// caused the status card to remount on the streaming -> results
// transition, which restarted the whole narrative from step 1.
type ViewState =
  | { kind: "empty" }
  | {
      kind: "active";
      steps: StreamStep[];
      leads: Lead[];
      relaxation: Relaxation;
      streamingDone: boolean;
      // Live = echte voortgang via SSE (prod-mode); animated = demo-mode
      // met fake delays.
      live: boolean;
    };

export default function DashboardPage() {
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [view, setView] = useState<ViewState>({ kind: "empty" });
  const [loading, setLoading] = useState(false);
  const [resultsView, setResultsView] = useState<ResultsView>("lijst");
  const [mode, setMode] = useState<"demo" | "prod">("demo");
  const [sort, setSort] = useState<SortKey>("warmte");
  const [resultFilters, setResultFilters] = useState<ResultFilters>({
    archetype: null,
    dienst: null,
  });
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);

  function toggleCompareSelection(kvk: string) {
    setSelectedForCompare((curr) =>
      curr.includes(kvk)
        ? curr.filter((k) => k !== kvk)
        : curr.length >= 5
          ? curr // cap op 5
          : [...curr, kvk],
    );
  }

  // We cachen de mode één keer op mount; dit beïnvloedt alleen welk
  // API-pad we kiezen, niet de UI zelf.
  useEffect(() => {
    fetch("/api/mode")
      .then((r) => (r.ok ? (r.json() as Promise<{ mode: "demo" | "prod" }>) : null))
      .then((data) => {
        if (data?.mode) setMode(data.mode);
      })
      .catch(() => {
        // silent — default "demo" is veilig
      });
  }, []);

  async function handleSearch() {
    setLoading(true);
    if (mode === "prod") {
      await runProdSearch();
    } else {
      await runDemoSearch();
    }
  }

  async function runDemoSearch() {
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      });
      const data = (await res.json()) as {
        steps: StreamStep[];
        leads: Lead[];
        relaxation: Relaxation;
      };
      setView({
        kind: "active",
        steps: data.steps,
        leads: data.leads,
        relaxation: data.relaxation ?? { regio: false, fte: false },
        streamingDone: false,
        live: false,
      });
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  }

  async function runProdSearch() {
    const liveSteps: StreamStep[] = [];
    setView({
      kind: "active",
      steps: liveSteps,
      leads: [],
      relaxation: { regio: false, fte: false },
      streamingDone: false,
      live: true,
    });
    try {
      const res = await fetch("/api/search/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      });
      if (!res.body) throw new Error("Geen SSE-body ontvangen");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\n\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            handleSseFrame(payload, liveSteps);
          } catch {
            // malformed frame — skip
          }
        }
      }
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  }

  function handleSseFrame(
    payload: { type: string } & Record<string, unknown>,
    steps: StreamStep[],
  ) {
    const append = (text: string) => {
      steps.push({ text, delay: 0 });
      setView((curr) =>
        curr.kind === "active"
          ? { ...curr, steps: [...steps] }
          : curr,
      );
    };
    if (payload.type === "stage") {
      append(String(payload.message ?? payload.stage));
    } else if (payload.type === "kvk") {
      append(`${payload.totalCandidates} bedrijven gevonden in KvK`);
    } else if (payload.type === "geo") {
      append(`${payload.remaining} bedrijven na regio-filter`);
    } else if (payload.type === "scrape") {
      append(`Scrape ${payload.scraped}/${payload.total}: ${payload.naam}`);
    } else if (payload.type === "score") {
      append(`Scoren ${payload.scored}/${payload.total}`);
    } else if (payload.type === "lead") {
      // Incremental delivery — push lead direct naar de view zodat
      // de gebruiker hem kan zien voordat de hele run klaar is.
      const lead = payload.lead as Lead;
      setView((curr) =>
        curr.kind === "active"
          ? {
              ...curr,
              leads: appendUnique(curr.leads, lead),
              streamingDone: true,
            }
          : curr,
      );
      setLoading(false);
    } else if (payload.type === "done") {
      // payload.totalCostUsd is canonical USD; tonen in EUR.
      const eur = Number(payload.totalCostUsd) / 1.1;
      append(
        `Klaar · ${payload.totalLeadsReturned} leads · €${eur.toFixed(3)}`,
      );
    } else if (payload.type === "error") {
      append(`Fout: ${payload.message}`);
    } else if (payload.type === "result") {
      const result = payload.result as {
        leads: Lead[];
        relaxation?: Relaxation;
      };
      setView((curr) =>
        curr.kind === "active"
          ? {
              ...curr,
              leads: result.leads,
              relaxation: result.relaxation ?? { regio: false, fte: false },
              streamingDone: true,
            }
          : curr,
      );
      setLoading(false);
    }
  }

  function handleStreamingComplete() {
    setView((curr) =>
      curr.kind === "active" ? { ...curr, streamingDone: true } : curr,
    );
    setLoading(false);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 md:px-8 md:pt-10">
      <section className="mb-6 flex items-end justify-between gap-4 md:mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-pavo-navy md:text-[28px]">
            Leads
          </h1>
          <p className="mt-1 text-sm text-pavo-gray-600">
            Stel filters in en laat de agent passende bedrijven onderzoeken.
          </p>
        </div>
        <div className="hidden items-center gap-1.5 rounded-full border border-pavo-teal/15 bg-pavo-teal/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-pavo-teal sm:inline-flex">
          <SparkSmall />
          Agent gereed
        </div>
      </section>

      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <BackgroundJobButton filters={filters} disabled={loading} />
        <SavedSearchControls
          filters={filters}
          onLoad={(f) => setFilters(f)}
        />
      </div>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        onSubmit={handleSearch}
        loading={loading}
      />

      <div className="mt-8 space-y-6">
        <AnimatePresence mode="wait">
          {view.kind === "empty" && (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <EmptyState />
            </motion.div>
          )}
        </AnimatePresence>

        <CompareBar
          selected={selectedForCompare}
          onClear={() => setSelectedForCompare([])}
          onRemove={(kvk) =>
            setSelectedForCompare((curr) => curr.filter((k) => k !== kvk))
          }
        />

        {view.kind === "active" && (
          <>
            {/* key moet stabiel blijven binnen één zoekopdracht (anders
                remount de component en reset de ticker); voor prod-mode
                is de key gewoon "live" want live-steps groeien dynamisch. */}
            <StreamingStatus
              key={view.live ? "live" : view.steps[0]?.text ?? "demo"}
              steps={view.steps}
              onComplete={handleStreamingComplete}
              live={view.live}
              liveDone={view.live ? view.streamingDone : undefined}
            />

            <AnimatePresence>
              {view.streamingDone && (
                <motion.div
                  key="results"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className="space-y-6"
                >
                  {(view.relaxation.regio || view.relaxation.fte) &&
                    view.leads.length > 0 && (
                      <RelaxationNotice relaxation={view.relaxation} />
                    )}

                  {view.leads.length > 0 && (
                    <SearchSummary filters={filters} leads={view.leads} />
                  )}

                  <FilteredResults
                    leads={view.leads}
                    sort={sort}
                    filters={resultFilters}
                    onSort={setSort}
                    onFilters={setResultFilters}
                    resultsView={resultsView}
                    onResultsView={setResultsView}
                    searchFilters={filters}
                    selectedForCompare={selectedForCompare}
                    onToggleCompare={toggleCompareSelection}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}

// Apply sort + filter on the lead-set, render either the grid or the
// map. Houdt de UI van de hoofdpagina overzichtelijk.
// Push een lead aan een bestaande lijst, of update als 'm al bestaat
// (op kvk). Houdt de UI consistent als het backend een lead twee keer
// emit (bij refresh).
function appendUnique(leads: Lead[], lead: Lead): Lead[] {
  const idx = leads.findIndex((l) => l.kvk === lead.kvk);
  if (idx === -1) return [...leads, lead];
  const next = [...leads];
  next[idx] = lead;
  return next;
}

function FilteredResults({
  leads,
  sort,
  filters,
  onSort,
  onFilters,
  resultsView,
  onResultsView,
  searchFilters,
  selectedForCompare,
  onToggleCompare,
}: {
  leads: Lead[];
  sort: SortKey;
  filters: ResultFilters;
  onSort: (s: SortKey) => void;
  onFilters: (f: ResultFilters) => void;
  resultsView: ResultsView;
  onResultsView: (v: ResultsView) => void;
  searchFilters: SearchFilters;
  selectedForCompare: string[];
  onToggleCompare: (kvk: string) => void;
}) {
  const visible = useMemo(() => {
    const filtered = leads.filter((l) => {
      if (filters.archetype && l.archetype?.naam !== filters.archetype) {
        return false;
      }
      if (filters.dienst) {
        const has = l.diensten.some(
          (d) => d.code === filters.dienst && d.prioriteit === "primair",
        );
        if (!has) return false;
      }
      return true;
    });
    return sortLeads(filtered, sort);
  }, [leads, filters, sort]);

  const hot = visible.filter((l) => l.warmte === "HOT").length;
  const warm = visible.filter((l) => l.warmte === "WARM").length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-pavo-navy">
            {visible.length} {visible.length === 1 ? "lead" : "leads"}
            {visible.length !== leads.length && (
              <span className="ml-1.5 text-sm font-normal text-pavo-gray-600">
                van {leads.length}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2 text-xs text-pavo-gray-600">
            {hot > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-pavo-orange" />
                {hot} hot
              </span>
            )}
            {warm > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-300" />
                {warm} warm
              </span>
            )}
          </div>
        </div>
        {leads.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <ResultsToolbar
              leads={leads}
              sort={sort}
              filters={filters}
              onSort={onSort}
              onFilters={onFilters}
            />
            <ExportCsvButton filters={searchFilters} />
            <ResultsTabs value={resultsView} onChange={onResultsView} />
          </div>
        )}
      </div>

      {resultsView === "lijst" ? (
        <LeadGrid
          leads={visible}
          selected={selectedForCompare}
          onToggleSelect={onToggleCompare}
        />
      ) : (
        <ResultsMap leads={visible} />
      )}
    </div>
  );
}

function sortLeads(leads: Lead[], sort: SortKey): Lead[] {
  const warmteRank: Record<Lead["warmte"], number> = {
    HOT: 0,
    WARM: 1,
    COLD: 2,
  };
  const fteRank: Record<FteKlasse, number> = {
    "10-19": 0,
    "20-49": 1,
    "50-99": 2,
    "100-199": 3,
  };
  const topScore = (l: Lead) => l.diensten[0]?.score ?? 0;
  return [...leads].sort((a, b) => {
    switch (sort) {
      case "warmte":
        return warmteRank[a.warmte] - warmteRank[b.warmte];
      case "score":
        return topScore(b) - topScore(a);
      case "fte":
        return fteRank[b.fte_klasse] - fteRank[a.fte_klasse];
      case "naam":
        return a.naam.localeCompare(b.naam);
    }
  });
}

function EmptyState() {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-pavo-ink/[0.06] bg-gradient-to-br from-white via-pavo-cream to-pavo-frost/60 p-10 text-center md:p-16">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-pavo-teal/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-pavo-orange/10 blur-3xl"
      />

      <div className="relative mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-pavo-teal to-pavo-navy shadow-[0_10px_30px_-10px_rgba(15,62,71,0.5)]">
        <SearchGlassIcon className="h-8 w-8 text-white" />
      </div>
      <h2 className="relative mt-5 text-xl font-semibold text-pavo-navy md:text-2xl">
        Klaar om bedrijven te vinden
      </h2>
      <p className="relative mx-auto mt-2 max-w-md text-sm leading-relaxed text-pavo-gray-600 md:text-[15px]">
        Pas hierboven de filters aan en klik op{" "}
        <span className="rounded-md bg-white/80 px-1.5 py-0.5 font-medium text-pavo-navy ring-1 ring-pavo-ink/[0.08]">
          Zoek leads
        </span>
        . De agent neemt het vanaf daar over.
      </p>
    </div>
  );
}

function BackgroundJobButton({
  filters,
  disabled,
}: {
  filters: SearchFilters;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(true);
  const [success, setSuccess] = useState(false);

  async function handleClick() {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const res = await fetch("/api/search-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters,
          naam: `${filters.branche} · ${new Date().toLocaleDateString("nl-NL")}`,
          use_batch: true,
        }),
      });
      if (res.status === 401 || res.status === 503) {
        setAvailable(false);
        return;
      }
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 4000);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!available) return null;

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || disabled}
        className="inline-flex items-center gap-1.5 rounded-full border border-pavo-ink/[0.08] bg-white/80 px-3 py-1.5 text-xs font-semibold text-pavo-navy backdrop-blur-sm transition-all duration-200 hover:border-pavo-teal/40 hover:bg-white hover:text-pavo-teal disabled:opacity-50"
        title="Plan deze zoekopdracht als achtergrond-job (geen wachten in browser)"
      >
        <ClockIcon className="h-3.5 w-3.5" />
        {busy ? "Plannen…" : "Run in achtergrond"}
      </button>
      {success && (
        <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Gepland — zie /search-jobs
        </span>
      )}
    </div>
  );
}

function ExportCsvButton({ filters }: { filters: SearchFilters }) {
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/export/csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pavo-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-full border border-pavo-ink/[0.08] bg-white/80 px-3 py-1.5 text-xs font-semibold text-pavo-navy backdrop-blur-sm transition-all duration-200 hover:border-pavo-teal/40 hover:bg-white hover:text-pavo-teal disabled:opacity-50"
    >
      <DownloadIcon className="h-3.5 w-3.5" />
      {busy ? "Exporteren…" : "CSV"}
    </button>
  );
}

function RelaxationNotice({ relaxation }: { relaxation: Relaxation }) {
  const parts: string[] = [];
  if (relaxation.regio) parts.push("het zoekgebied");
  if (relaxation.fte) parts.push("de FTE-selectie");
  const joined =
    parts.length === 2 ? parts.join(" en ") : parts[0] ?? "de filters";

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-pavo-orange/25 bg-gradient-to-br from-pavo-orange/[0.07] to-transparent px-4 py-3 text-sm text-pavo-navy">
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pavo-orange/15 text-pavo-orange">
        <InfoIcon className="h-3.5 w-3.5" />
      </span>
      <p className="leading-relaxed">
        <span className="font-semibold text-pavo-orange">Filters verruimd. </span>
        Geen bedrijven voldeden aan de oorspronkelijke filters, daarom heeft de
        agent {joined} verruimd om je toch relevante leads te tonen.
      </p>
    </div>
  );
}

function ResultsTabs({
  value,
  onChange,
}: {
  value: ResultsView;
  onChange: (v: ResultsView) => void;
}) {
  return (
    <div className="relative inline-flex rounded-full border border-pavo-ink/[0.08] bg-white/80 p-1 backdrop-blur-sm">
      {(
        [
          { id: "lijst" as const, label: "Lijst", icon: ListIcon },
          { id: "kaart" as const, label: "Kaart", icon: MapIcon },
        ] as const
      ).map((tab) => {
        const active = value === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? "text-white"
                : "text-pavo-gray-600 hover:text-pavo-navy"
            }`}
          >
            {active && (
              <motion.span
                layoutId="results-tab-bg"
                className="absolute inset-0 rounded-full bg-gradient-to-br from-pavo-teal to-pavo-navy shadow-[0_4px_12px_-4px_rgba(15,62,71,0.5)]"
                transition={{ type: "spring", duration: 0.4, bounce: 0.18 }}
              />
            )}
            <Icon className="relative h-3.5 w-3.5" />
            <span className="relative">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ListIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <path d="M5 6h11M5 10h11M5 14h11" />
      <circle cx="2.5" cy="6" r="0.8" fill="currentColor" />
      <circle cx="2.5" cy="10" r="0.8" fill="currentColor" />
      <circle cx="2.5" cy="14" r="0.8" fill="currentColor" />
    </svg>
  );
}

function MapIcon({ className = "" }: { className?: string }) {
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
      <path d="M7 4 2 6v11l5-2 6 2 5-2V4l-5 2z" />
      <path d="M7 4v11M13 6v11" />
    </svg>
  );
}

function SearchGlassIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <circle cx="21" cy="21" r="13" />
      <path d="m30 30 10 10" />
    </svg>
  );
}

function DownloadIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M3.5 14.5v1A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5v-1" />
    </svg>
  );
}

function ClockIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6v4l2.5 2" />
    </svg>
  );
}

function InfoIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path
        fillRule="evenodd"
        d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.75 6.5a.75.75 0 0 0-1.5 0v5a.75.75 0 0 0 1.5 0v-5ZM10 5.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function SparkSmall() {
  return (
    <span className="relative inline-flex h-1.5 w-1.5">
      <span className="absolute inset-0 animate-ping rounded-full bg-pavo-teal/40" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-pavo-teal" />
    </span>
  );
}
