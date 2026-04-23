"use client";

import { motion } from "motion/react";
import type { Signaal } from "@/lib/adapters/types";

export default function SignalList({ signalen }: { signalen: Signaal[] }) {
  return (
    <section className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SearchIcon className="h-4 w-4 text-pavo-teal" />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
            Onderliggende signalen
          </h2>
        </div>
        {signalen.length > 0 && (
          <span className="text-xs text-pavo-gray-600">
            {signalen.length}{" "}
            {signalen.length === 1
              ? "bron geraadpleegd"
              : "bronnen geraadpleegd"}
          </span>
        )}
      </div>

      {signalen.length === 0 ? (
        <p className="mt-3 text-sm text-pavo-gray-600">
          Geen significante HR-signalen gedetecteerd.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {signalen.map((s, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.25,
                delay: i * 0.15,
                ease: "easeOut",
              }}
              className="flex items-start justify-between gap-4"
            >
              <div className="flex items-start gap-3 text-sm text-pavo-gray-900">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-pavo-teal" />
                <span>{s.tekst}</span>
              </div>
              <span className="shrink-0 rounded bg-pavo-gray-100 px-2 py-0.5 text-xs text-pavo-gray-600">
                {s.bron}
              </span>
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SearchIcon({ className = "" }: { className?: string }) {
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
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13 13 3.5 3.5" />
    </svg>
  );
}
