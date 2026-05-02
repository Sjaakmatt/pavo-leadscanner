"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import ArchetypeCard from "@/components/ArchetypeCard";
import ColdContext from "@/components/ColdContext";
import CompanyDataCard from "@/components/CompanyDataCard";
import ContactsCard from "@/components/ContactsCard";
import LeadBriefing from "@/components/LeadBriefing";
import LeadChat from "@/components/LeadChat";
import LeadStatusBar from "@/components/LeadStatusBar";
import LeadTrend from "@/components/LeadTrend";
import OnboardingAgent from "@/components/OnboardingAgent";
import ServiceMatchBar from "@/components/ServiceMatchBar";
import SignalList from "@/components/SignalList";
import WarmteBadge from "@/components/WarmteBadge";
import type { Lead } from "@/lib/adapters/types";

type Props = { params: Promise<{ kvk: string }> };

export default function LeadDetailPage({ params }: Props) {
  const { kvk } = use(params);
  const [lead, setLead] = useState<Lead | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

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
      <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
        <BackLink />
        <div className="mt-8 rounded-2xl border border-pavo-ink/[0.06] bg-white p-10 text-center shadow-card">
          <p className="text-sm text-pavo-gray-600">
            Lead met KvK <span className="font-mono font-medium text-pavo-navy">{kvk}</span>{" "}
            niet gevonden.
          </p>
        </div>
      </div>
    );
  }

  if (!lead) {
    // Korte skeleton — de data staat al lokaal paraat, dit knippert
    // meestal maar 1 frame.
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
        <div className="h-4 w-40 animate-pulse rounded-full bg-pavo-ink/[0.08]" />
        <div className="mt-6 h-10 w-2/3 animate-pulse rounded-xl bg-pavo-ink/[0.08]" />
        <div className="mt-4 h-4 w-1/3 animate-pulse rounded-full bg-pavo-ink/[0.06]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-8 md:px-8 md:pt-10">
      <BackLink />

      <header className="relative mt-6 overflow-hidden rounded-3xl border border-pavo-ink/[0.06] bg-white p-6 shadow-card-lg md:mt-8 md:p-8">
        {/* Top accent — kleur is afhankelijk van warmte */}
        <div
          aria-hidden
          className={`absolute inset-x-0 top-0 h-1 ${
            lead.warmte === "HOT"
              ? "bg-gradient-to-r from-pavo-orange via-pavo-coral to-pavo-orange"
              : lead.warmte === "WARM"
              ? "bg-gradient-to-r from-amber-300 via-amber-400 to-amber-300"
              : "bg-gradient-to-r from-pavo-gray-100 to-pavo-gray-100"
          }`}
        />
        {lead.warmte === "HOT" && (
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-pavo-orange/10 blur-3xl"
          />
        )}

        <div className="relative flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <WarmteBadge warmte={lead.warmte} />
              <span className="font-mono text-[11px] text-pavo-gray-600">
                KvK {lead.kvk}
              </span>
            </div>
            <h1 className="mt-3 text-3xl font-semibold leading-[1.1] tracking-tight text-pavo-navy md:text-4xl">
              {lead.naam}
            </h1>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-pavo-gray-600">
              <MetaPill icon={<PinIcon className="h-3 w-3" />}>
                {lead.plaats}, {lead.provincie}
              </MetaPill>
              <MetaPill icon={<UsersIcon className="h-3 w-3" />}>
                {lead.fte_klasse} FTE
              </MetaPill>
              <MetaPill icon={<TagIcon className="h-3 w-3" />}>
                {lead.sector}
              </MetaPill>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="group relative inline-flex shrink-0 items-center gap-2 overflow-hidden rounded-xl bg-gradient-to-br from-pavo-teal to-pavo-navy px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_-4px_rgba(15,62,71,0.5)] transition-all duration-200 hover:shadow-[0_8px_24px_-4px_rgba(15,62,71,0.6)] md:px-5"
          >
            <ChatIcon className="h-4 w-4 transition-transform duration-300 group-hover:rotate-[-6deg]" />
            <span>Vraag de agent</span>
          </button>
        </div>
      </header>

      <motion.div
        initial="hidden"
        animate="shown"
        variants={{
          hidden: {},
          shown: { transition: { staggerChildren: 0.07 } },
        }}
        className="mt-6 space-y-5"
      >
        <SectionFade>
          <LeadStatusBar kvk={lead.kvk} />
        </SectionFade>

        <SectionFade>
          <OnboardingAgent kvk={lead.kvk} leadNaam={lead.naam} />
        </SectionFade>

        {lead.warmte === "COLD" && (
          <SectionFade>
            <ColdContext lead={lead} />
          </SectionFade>
        )}

        <SectionFade>
          <LeadBriefing
            kvk={lead.kvk}
            fallbackObservatie={lead.observatie}
          />
        </SectionFade>

        <SectionFade>
          <CompanyDataCard kvk={lead.kvk} />
        </SectionFade>

        <SectionFade>
          <ArchetypeCard archetype={lead.archetype} />
        </SectionFade>

        <SectionFade>
          <ContactsCard kvk={lead.kvk} />
        </SectionFade>

        <SectionFade>
          <ServiceMatchBar diensten={lead.diensten} />
        </SectionFade>

        <SectionFade>
          <LeadTrend kvk={lead.kvk} />
        </SectionFade>

        <SectionFade>
          <SignalList signalen={lead.signalen} />
        </SectionFade>
      </motion.div>

      <LeadChat
        kvk={lead.kvk}
        leadNaam={lead.naam}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="group inline-flex items-center gap-1.5 text-sm font-medium text-pavo-gray-600 transition-colors hover:text-pavo-teal"
    >
      <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
      Terug naar resultaten
    </Link>
  );
}

function MetaPill({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-pavo-frost/60 px-2 py-1 text-[12px] font-medium text-pavo-navy">
      <span className="text-pavo-teal">{icon}</span>
      {children}
    </span>
  );
}

function ChatIcon({ className = "" }: { className?: string }) {
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
      <path d="M3 4.5h14v10H11l-4 3v-3H3z" />
      <path d="M6.5 8.5h7M6.5 11.5h4.5" />
    </svg>
  );
}

function ArrowLeft({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M16 10H4M9 5l-5 5 5 5" />
    </svg>
  );
}

function PinIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path d="M10 1.5c-3 0-5.5 2.4-5.5 5.4 0 4 5.5 11.6 5.5 11.6S15.5 11 15.5 7c0-3-2.5-5.5-5.5-5.5zm0 7.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" />
    </svg>
  );
}

function UsersIcon({ className = "" }: { className?: string }) {
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
      <circle cx="7" cy="7" r="2.5" />
      <path d="M2.5 16c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" />
      <path d="M14 8a2 2 0 1 0-1-3.7" />
      <path d="M13 11.5c2 0 4.5 1.5 4.5 4.5" />
    </svg>
  );
}

function TagIcon({ className = "" }: { className?: string }) {
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
      <path d="M10.5 2.5h6V8L9 16l-7-7 8.5-6.5z" />
      <circle cx="13.5" cy="6.5" r="1" fill="currentColor" />
    </svg>
  );
}

function SectionFade({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 10 },
        shown: { opacity: 1, y: 0, transition: { duration: 0.3 } },
      }}
    >
      {children}
    </motion.div>
  );
}
