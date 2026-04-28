"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { LeadStatus, LeadStatusRow } from "@/lib/lead-status/types";

// Onboarding-agent visualisatie. Wordt alleen getoond zodra de
// lead-status op 'gewonnen' staat. De flow is bewust visueel —
// geen echte CRM-call. Doel: tonen hoe FactumAI een onboarding-agent
// inzet zodra een sales-lead converteert.
//
// Stap-progressie:
//   1. Klant-record aanmaken (HubSpot/Pipedrive)
//   2. Contracttemplate genereren (e-sign)
//   3. Welkomstmail versturen (decision-maker uit KvK)
//   4. Kickoff-meeting plannen (Calendar)
//   5. Onboarding-checklist activeren (Slack)
//
// Iedere stap krijgt een fake delay (700-1400ms) zodat de animatie
// 'm-reflex' aanvoelt. Na de laatste stap → "Klant onboard"-bevestiging
// + ROI-cijfer.

type Step = {
  id: string;
  label: string;
  detail: string;
  systeem: string;
};

const STEPS: Step[] = [
  {
    id: "create-contact",
    label: "Klant-record aanmaken",
    detail: "Bedrijfsdata + decision-makers uit PAVO doorgezet",
    systeem: "HubSpot",
  },
  {
    id: "contract",
    label: "Contracttemplate genereren",
    detail: "PAVO-dienstmatch ingevuld als startpakket",
    systeem: "DocuSign",
  },
  {
    id: "welcome",
    label: "Welkomstmail versturen",
    detail: "Persoonlijke intro met onboarding-stappen",
    systeem: "Outlook",
  },
  {
    id: "kickoff",
    label: "Kickoff-meeting plannen",
    detail: "Beschikbaarheid van consultant + DMU gematcht",
    systeem: "Google Calendar",
  },
  {
    id: "checklist",
    label: "Onboarding-checklist activeren",
    detail: "Eerste 30-60-90d milestones live in Slack",
    systeem: "Slack",
  },
];

type Phase = "idle" | "running" | "done";

type Props = {
  kvk: string;
  leadNaam: string;
};

export default function OnboardingAgent({ kvk, leadNaam }: Props) {
  const [status, setStatus] = useState<LeadStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  // Lees lead-status — alleen tonen als gewonnen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/lead-status/${kvk}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { status: LeadStatusRow | null };
        if (!cancelled) {
          setStatus((body.status?.status as LeadStatus) ?? null);
        }
      } catch {
        // silent
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kvk]);

  // Reset wanneer status terugkruipt naar iets anders.
  useEffect(() => {
    if (status !== "gewonnen") {
      setPhase("idle");
      setActiveIdx(-1);
      setCompleted(new Set());
    }
  }, [status]);

  function startOnboarding() {
    if (phase === "running") return;
    setPhase("running");
    setActiveIdx(0);
    setCompleted(new Set());
    runStep(0);
  }

  function runStep(idx: number) {
    if (idx >= STEPS.length) {
      setActiveIdx(-1);
      setPhase("done");
      return;
    }
    setActiveIdx(idx);
    const delay = 700 + Math.floor(Math.random() * 700);
    setTimeout(() => {
      setCompleted((curr) => {
        const next = new Set(curr);
        next.add(STEPS[idx].id);
        return next;
      });
      runStep(idx + 1);
    }, delay);
  }

  function reset() {
    setPhase("idle");
    setActiveIdx(-1);
    setCompleted(new Set());
  }

  if (status !== "gewonnen") return null;

  return (
    <section className="overflow-hidden rounded-lg border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <RocketIcon className="h-5 w-5 text-emerald-700" />
          <div>
            <h2 className="text-sm font-semibold text-emerald-800">
              Klant geconverteerd
            </h2>
            <p className="text-xs text-emerald-700/80">
              {leadNaam} is gewonnen — laat de onboarding-agent
              {phase === "done" ? " het overdraagt" : " het overdragen"}.
            </p>
          </div>
        </div>
        {phase === "idle" && (
          <button
            type="button"
            onClick={startOnboarding}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800"
          >
            <SparkleIcon className="h-3.5 w-3.5" />
            Onboard in CRM
          </button>
        )}
        {phase === "done" && (
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
          >
            Demo opnieuw
          </button>
        )}
      </div>

      {phase !== "idle" && (
        <ol className="mt-4 space-y-2">
          {STEPS.map((step, i) => {
            const isDone = completed.has(step.id);
            const isActive = activeIdx === i;
            return (
              <li
                key={step.id}
                className={`flex items-start gap-3 rounded-md border px-3 py-2 transition-colors ${
                  isDone
                    ? "border-emerald-200 bg-white"
                    : isActive
                      ? "border-pavo-teal/40 bg-white"
                      : "border-pavo-gray-100 bg-pavo-gray-50/40"
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {isDone ? (
                    <CheckCircle className="h-5 w-5 text-emerald-600" />
                  ) : isActive ? (
                    <Spinner />
                  ) : (
                    <Circle className="h-5 w-5 text-pavo-gray-100" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className={`text-sm font-medium ${
                        isDone || isActive
                          ? "text-pavo-gray-900"
                          : "text-pavo-gray-600"
                      }`}
                    >
                      {step.label}
                    </p>
                    <span className="text-[10px] uppercase tracking-wide text-pavo-gray-600">
                      {step.systeem}
                    </span>
                  </div>
                  <AnimatePresence>
                    {(isActive || isDone) && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="mt-0.5 text-xs text-pavo-gray-600"
                      >
                        {step.detail}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <AnimatePresence>
        {phase === "done" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2"
          >
            <p className="text-sm font-semibold text-emerald-800">
              ✓ Klant onboard — geschat ~75 minuten handmatig werk bespaard
            </p>
            <p className="mt-0.5 text-xs text-emerald-700/80">
              Visuele demo. Echte CRM-koppelingen volgen in een
              vervolg-PR (HubSpot Private App + Pipedrive OAuth).
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-pavo-teal/20 border-t-pavo-teal"
    />
  );
}

function CheckCircle({ className = "" }: { className?: string }) {
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
      <circle cx="10" cy="10" r="8" />
      <path d="M6.5 10.5 9 13l5-5.5" />
    </svg>
  );
}

function Circle({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
      aria-hidden
    >
      <circle cx="10" cy="10" r="8" />
    </svg>
  );
}

function RocketIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M14 4c4 0 6 2 6 6 0 4-3 7-7 8l-2-2 2-3" />
      <path d="M10 18c-3 1-5-1-5-3 1-3 4-5 7-6l-2 4Z" />
      <circle cx="15" cy="9" r="1.2" fill="currentColor" />
    </svg>
  );
}

function SparkleIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <path d="M10 2v4M10 14v4M2 10h4M14 10h4M4.5 4.5l2.8 2.8M12.7 12.7l2.8 2.8" />
    </svg>
  );
}
