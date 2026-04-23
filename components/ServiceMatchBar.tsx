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
    <section className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm md:p-6">
      <div className="flex items-center gap-2">
        <BadgeIcon className="h-4 w-4 text-pavo-teal" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
          Match met PAVO-diensten
        </h2>
      </div>

      {diensten.length === 0 ? (
        <p className="mt-3 text-sm text-pavo-gray-600">
          Geen significante dienst-match gevonden.
        </p>
      ) : (
        <div className="mt-4 space-y-6">
          {primair.length > 0 && (
            <Group title="Primair" items={primair} />
          )}
          {secundair.length > 0 && (
            <Group title="Secundair" items={secundair} />
          )}
        </div>
      )}
    </section>
  );
}

function Group({ title, items }: { title: string; items: DienstMatch[] }) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
        {title}
      </h3>
      <ul className="space-y-4">
        {items.map((d) => (
          <li key={d.code}>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="inline-flex min-w-[36px] justify-center rounded-md bg-pavo-teal/10 px-2 py-0.5 text-xs font-semibold text-pavo-teal">
                  {d.code}
                </span>
                <span className="text-pavo-gray-900">{d.naam}</span>
              </div>
              <span className="text-sm font-semibold tabular-nums text-pavo-navy">
                {d.score}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-pavo-gray-100">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${d.score}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="h-full rounded-full bg-pavo-teal"
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
