"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { Lead } from "@/lib/adapters/types";
import WarmteBadge from "./WarmteBadge";

type Props = {
  lead: Lead;
  index: number;
};

export default function LeadCard({ lead, index }: Props) {
  const primaireDiensten = lead.diensten
    .filter((d) => d.prioriteit === "primair")
    .slice(0, 3);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.05, ease: "easeOut" }}
    >
      <Link
        href={`/lead/${lead.kvk}`}
        className="group block rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold leading-tight text-pavo-navy">
            {lead.naam}
          </h3>
          <WarmteBadge warmte={lead.warmte} />
        </div>

        <div className="mt-3 text-sm text-pavo-gray-600">
          {lead.plaats}, {lead.provincie}
          <br />
          KvK {lead.kvk}
        </div>

        <div className="my-4 h-px bg-pavo-gray-100" />

        <div className="text-sm text-pavo-gray-900">{lead.sector}</div>
        <div className="mt-1 text-sm text-pavo-gray-600">
          {lead.fte_klasse} FTE
        </div>

        <div className="my-4 h-px bg-pavo-gray-100" />

        <div className="text-sm text-pavo-gray-900">
          {lead.signalen.length > 0
            ? `${lead.signalen.length} HR-signalen gedetecteerd`
            : "Geen HR-signalen gedetecteerd"}
        </div>

        {primaireDiensten.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="text-xs text-pavo-gray-600">Match:</span>
            {primaireDiensten.map((d) => (
              <span
                key={d.code}
                className="inline-flex items-center rounded-md bg-pavo-teal/10 px-2 py-0.5 text-xs font-semibold text-pavo-teal"
              >
                {d.code}
              </span>
            ))}
          </div>
        )}
      </Link>
    </motion.div>
  );
}
