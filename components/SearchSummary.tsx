"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { Lead, SearchFilters } from "@/lib/adapters/types";

type Status = "loading" | "streaming" | "done" | "error";

type Props = {
  filters: SearchFilters;
  leads: Lead[];
};

export default function SearchSummary({ filters, leads }: Props) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setText("");
    setStatus("loading");

    const payload = {
      filters: {
        branche: filters.branche,
        fte_klassen: filters.fte_klassen,
        regio_center: filters.regio_center,
        regio_straal_km: filters.regio_straal_km,
      },
      leads: leads.map((l) => ({
        naam: l.naam,
        plaats: l.plaats,
        warmte: l.warmte,
        fte_klasse: l.fte_klasse,
        archetype: l.archetype?.naam ?? null,
        top_signaal: l.signalen[0]?.tekst ?? null,
        dienst_codes: l.diensten
          .filter((d) => d.prioriteit === "primair")
          .map((d) => d.code),
      })),
    };

    (async () => {
      try {
        const res = await fetch("/api/search-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(payload),
        });
        if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
        setStatus("streaming");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (cancelled) return;
          acc += decoder.decode(value, { stream: true });
          setText(acc);
        }
        acc += decoder.decode();
        if (cancelled) return;
        setText(acc);
        setStatus("done");
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (cancelled) return;
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filters, leads]);

  if (status === "error") return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="relative overflow-hidden rounded-2xl border border-pavo-teal/15 bg-gradient-to-br from-pavo-teal/[0.06] via-white to-pavo-mint/[0.04] p-5 md:p-7"
    >
      {/* Decoratief blob-licht */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-pavo-teal/15 blur-3xl"
      />

      <div className="relative flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-pavo-teal to-pavo-navy shadow-[0_2px_8px_-2px_rgba(15,62,71,0.4)]">
          <SparkIcon className="h-3.5 w-3.5 text-white" />
        </span>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pavo-teal">
          Wat de agent opmerkt over deze set
        </h2>
        {status === "streaming" && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-pavo-teal/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pavo-teal">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pavo-teal" />
            Live
          </span>
        )}
      </div>

      <div className="relative mt-4 min-h-[2.5rem]">
        {status === "loading" ? (
          <div className="space-y-2">
            <div className="h-3.5 w-3/4 animate-pulse rounded-full bg-pavo-teal/10" />
            <div className="h-3.5 w-2/3 animate-pulse rounded-full bg-pavo-teal/10" />
          </div>
        ) : (
          <p className="text-[15px] leading-relaxed text-pavo-navy md:text-base">
            {text}
            {status === "streaming" && (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-pavo-teal align-middle"
              />
            )}
          </p>
        )}
      </div>
    </motion.section>
  );
}

function SparkIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M10 1.5l1.4 4.2 4.2 1.4-4.2 1.4L10 12.7l-1.4-4.2L4.4 7.1 8.6 5.7 10 1.5zM15.5 12l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
    </svg>
  );
}
