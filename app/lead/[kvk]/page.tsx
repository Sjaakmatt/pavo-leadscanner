"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import ArchetypeCard from "@/components/ArchetypeCard";
import ServiceMatchBar from "@/components/ServiceMatchBar";
import SignalList from "@/components/SignalList";
import WarmteBadge from "@/components/WarmteBadge";
import type { Lead } from "@/lib/adapters/types";

type Props = { params: Promise<{ kvk: string }> };

export default function LeadDetailPage({ params }: Props) {
  const { kvk } = use(params);
  const [lead, setLead] = useState<Lead | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/lead/${kvk}`);
      const data = (await res.json()) as { lead: Lead | null };
      if (cancelled) return;
      if (!data.lead) {
        setNotFound(true);
        return;
      }
      setLead(data.lead);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [kvk]);

  if (notFound) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-10">
        <Link
          href="/"
          className="text-sm text-pavo-gray-600 transition-colors hover:text-pavo-teal"
        >
          ← Terug naar resultaten
        </Link>
        <div className="mt-6 rounded-lg border border-pavo-gray-100 bg-white p-6 text-center shadow-sm md:p-10">
          <p className="text-sm text-pavo-gray-600">
            Lead met KvK {kvk} niet gevonden.
          </p>
        </div>
      </div>
    );
  }

  if (!lead) {
    // Korte skeleton — de data staat al lokaal paraat, dit knippert
    // meestal maar 1 frame.
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-10">
        <div className="h-4 w-40 animate-pulse rounded bg-pavo-gray-100" />
        <div className="mt-6 h-8 w-2/3 animate-pulse rounded bg-pavo-gray-100" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-pavo-gray-600 transition-colors hover:text-pavo-teal"
      >
        ← Terug naar resultaten
      </Link>

      <header className="mt-5 md:mt-6">
        <WarmteBadge warmte={lead.warmte} />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-pavo-navy md:text-3xl">
          {lead.naam}
        </h1>
        <p className="mt-2 text-sm text-pavo-gray-600">
          {lead.plaats}, {lead.provincie} · KvK {lead.kvk} · {lead.fte_klasse}{" "}
          FTE
        </p>
        <p className="text-sm text-pavo-gray-600">{lead.sector}</p>
      </header>

      <motion.div
        initial="hidden"
        animate="shown"
        variants={{
          hidden: {},
          shown: { transition: { staggerChildren: 0.08 } },
        }}
        className="mt-6 space-y-6"
      >
        <SectionFade>
          <ArchetypeCard archetype={lead.archetype} />
        </SectionFade>

        <SectionFade>
          <AnalyseCard observatie={lead.observatie} />
        </SectionFade>

        <SectionFade>
          <ServiceMatchBar diensten={lead.diensten} />
        </SectionFade>

        <SectionFade>
          <SignalList signalen={lead.signalen} />
        </SectionFade>
      </motion.div>
    </div>
  );
}

function SectionFade({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        shown: { opacity: 1, y: 0, transition: { duration: 0.3 } },
      }}
    >
      {children}
    </motion.div>
  );
}

function AnalyseCard({ observatie }: { observatie: string }) {
  return (
    <section className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm md:p-6">
      <div className="flex items-center gap-2">
        <LightbulbIcon className="h-4 w-4 text-pavo-orange" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
          Analyse van de agent
        </h2>
      </div>
      <div className="mt-3 rounded-lg bg-pavo-gray-50 p-4 text-sm leading-relaxed text-pavo-gray-900 md:text-[15px]">
        {observatie}
      </div>
    </section>
  );
}

function LightbulbIcon({ className = "" }: { className?: string }) {
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
      <path d="M10 2.5a5.5 5.5 0 0 0-3.3 9.9c.5.4.8 1 .8 1.6v.5h5v-.5c0-.6.3-1.2.8-1.6A5.5 5.5 0 0 0 10 2.5Z" />
      <path d="M8 17h4" />
    </svg>
  );
}
