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
      className="rounded-lg border border-pavo-teal/20 bg-gradient-to-br from-pavo-teal/5 to-transparent p-5 md:p-6"
    >
      <div className="flex items-center gap-2">
        <SparkIcon className="h-4 w-4 text-pavo-teal" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-teal">
          Wat de agent opmerkt over deze set
        </h2>
        {status === "streaming" && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-pavo-gray-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pavo-teal" />
            Live
          </span>
        )}
      </div>

      <div className="mt-3 min-h-[2.5rem]">
        {status === "loading" ? (
          <div className="space-y-1.5">
            <div className="h-3 w-3/4 animate-pulse rounded bg-pavo-gray-100" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-pavo-gray-100" />
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-pavo-gray-900 md:text-[15px]">
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
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M10 2v4M10 14v4M2 10h4M14 10h4M4.5 4.5l2.8 2.8M12.7 12.7l2.8 2.8M15.5 4.5l-2.8 2.8M7.3 12.7l-2.8 2.8" />
    </svg>
  );
}
