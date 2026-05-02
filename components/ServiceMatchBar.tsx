"use client";

import { motion } from "motion/react";
import type { DienstMatch } from "@/lib/adapters/types";

export default function ServiceMatchBar({
  diensten,
}: {
  diensten: DienstMatch[];
}) {
  const primair = diensten.filter((d) => d.prioriteit === "primair");
  const secundair = diensten.filter((d) => d.prioriteit === "secundair");

  return (
    <section className="rounded-2xl border border-pavo-ink/[0.06] bg-white p-5 shadow-card md:p-7">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-pavo-teal/15 to-pavo-teal/5 text-pavo-teal">
          <BadgeIcon className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pavo-teal">
          Relevante PAVO-diensten
        </h2>
      </div>

      {diensten.length === 0 ? (
        <p className="mt-3 text-sm text-pavo-gray-600">
          Geen significante dienst-match gevonden.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm leading-relaxed text-pavo-gray-600">
            De agent heeft de signalen gematcht tegen het PAVO-portfolio. De
            score geeft aan hoe sterk het patroon aansluit — niet hoe kansrijk
            een verkoopgesprek is.
          </p>

          <div className="mt-6 space-y-7">
            {primair.length > 0 && (
              <Group title="Primair" tone="primary" items={primair} />
            )}
            {secundair.length > 0 && (
              <Group title="Secundair" tone="secondary" items={secundair} />
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Group({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "primary" | "secondary";
  items: DienstMatch[];
}) {
  const isPrimary = tone === "primary";
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            isPrimary ? "bg-pavo-orange" : "bg-pavo-teal/50"
          }`}
        />
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-pavo-gray-600">
          {title}
        </h3>
      </div>
      <ul className="space-y-4">
        {items.map((d, i) => (
          <li key={d.code}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-sm">
                <span className="inline-flex min-w-[40px] justify-center rounded-md bg-pavo-teal/10 px-2 py-0.5 font-mono text-[10px] font-bold text-pavo-teal">
                  {d.code}
                </span>
                <span className="font-semibold text-pavo-navy">{d.naam}</span>
              </div>
              <span className="font-bold tabular-nums text-pavo-navy">
                {d.score}
                <span className="text-xs font-medium text-pavo-gray-600">%</span>
              </span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-pavo-frost">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${d.score}%` }}
                transition={{
                  duration: 0.9,
                  delay: i * 0.07,
                  ease: "easeOut",
                }}
                className={`h-full rounded-full ${
                  isPrimary
                    ? "bg-gradient-to-r from-pavo-orange to-pavo-coral"
                    : "bg-gradient-to-r from-pavo-teal to-pavo-teal-bright"
                }`}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BadgeIcon({ className = "" }: { className?: string }) {
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
      <path d="M10 2.5 12 4l2.3-.3.4 2.3L16.7 7l-.9 2.2.9 2.2-2 1-.4 2.3L12 14l-2 1.5L8 14l-2.3.3-.4-2.3L3.3 11l.9-2.2L3.3 6.6l2-1 .4-2.3L8 4z" />
      <path d="m7.5 10 2 2 3.5-3.5" />
    </svg>
  );
}
