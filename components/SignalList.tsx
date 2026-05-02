"use client";

import { motion } from "motion/react";
import type { Bron, Signaal } from "@/lib/adapters/types";
import { bronSterkte } from "@/lib/claude";

const BRON_DESCRIPTIE: Record<Bron, string> = {
  KvK: "openbaar handelsregister",
  "KvK-historie": "historische mutaties (18 mnd)",
  "KvK-deponering": "jaarrekening-deponering",
  Vacatures: "vacature-aggregator",
  bedrijfswebsite: "eigen bedrijfssite (gescand)",
  "Rechtspraak.nl": "gepubliceerde uitspraken",
  NLA: "Nederlandse Arbeidsinspectie",
  Insolventieregister: "Centraal Insolventieregister",
  Nieuws: "lokale/vakmedia",
  CBS: "Centraal Bureau voor de Statistiek",
  "LinkedIn-bedrijfspagina": "publieke LinkedIn-pagina",
  Glassdoor: "medewerker-reviews",
};

export default function SignalList({ signalen }: { signalen: Signaal[] }) {
  return (
    <section
      id="signalen"
      className="rounded-2xl border border-pavo-ink/[0.06] bg-white p-5 shadow-card md:p-7"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-pavo-teal/15 to-pavo-teal/5 text-pavo-teal">
            <SearchIcon className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pavo-teal">
            Onderliggende signalen
          </h2>
        </div>
        {signalen.length > 0 && (
          <span className="rounded-full bg-pavo-frost px-2.5 py-0.5 text-[11px] font-medium text-pavo-gray-600">
            {signalen.length}{" "}
            {signalen.length === 1 ? "bron" : "bronnen"}
          </span>
        )}
      </div>

      {signalen.length === 0 ? (
        <p className="mt-3 text-sm text-pavo-gray-600">
          Geen significante HR-signalen gedetecteerd.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-pavo-frost/50 px-3.5 py-2.5 text-xs text-pavo-gray-600">
            <p className="leading-relaxed">
              Nummers worden in de briefing geciteerd als{" "}
              <CitationBadge inline>1</CitationBadge>.
            </p>
            <span className="hidden h-3 w-px bg-pavo-ink/[0.10] md:inline-block" />
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded bg-pavo-teal/10 px-1.5 py-0.5 font-medium text-pavo-teal">
                <CheckIcon className="h-2.5 w-2.5" />
                Feitelijk
              </span>
              <span>= verifieerbaar register</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded bg-pavo-orange/10 px-1.5 py-0.5 font-medium text-pavo-orange">
                <EyeIcon className="h-2.5 w-2.5" />
                Interpretatief
              </span>
              <span>= afgeleid uit content</span>
            </span>
          </div>

          <ol className="mt-5 space-y-3">
            {signalen.map((s, i) => (
              <SignalRow key={i} signaal={s} index={i + 1} delay={i * 0.07} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function SignalRow({
  signaal,
  index,
  delay,
}: {
  signaal: Signaal;
  index: number;
  delay: number;
}) {
  const sterkte = bronSterkte(signaal.bron);
  const isFeitelijk = sterkte === "Feitelijk";

  return (
    <motion.li
      id={`signaal-${index}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay, ease: "easeOut" }}
      className="group flex items-start gap-3 rounded-xl border border-transparent p-3 transition-colors hover:border-pavo-ink/[0.05] hover:bg-pavo-frost/40"
    >
      <span
        className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold shadow-[0_2px_6px_-2px_rgba(15,62,71,0.3)] ${
          isFeitelijk
            ? "bg-gradient-to-br from-pavo-teal to-pavo-navy text-white"
            : "bg-gradient-to-br from-pavo-orange to-pavo-coral text-white"
        }`}
      >
        {index}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-relaxed text-pavo-navy md:text-[15px]">
          {signaal.tekst}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          <span
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold ${
              isFeitelijk
                ? "bg-pavo-teal/10 text-pavo-teal"
                : "bg-pavo-orange/10 text-pavo-orange"
            }`}
            title={
              isFeitelijk
                ? "Verifieerbaar in een register of externe dataset"
                : "Interpretatie van gepubliceerde content — kan achterhaald zijn"
            }
          >
            {isFeitelijk ? (
              <CheckIcon className="h-3 w-3" />
            ) : (
              <EyeIcon className="h-3 w-3" />
            )}
            {sterkte}
          </span>
          <span className="text-pavo-gray-600">
            <span className="font-semibold text-pavo-navy">
              {signaal.bron}
            </span>{" "}
            <span className="text-pavo-gray-600">
              · {BRON_DESCRIPTIE[signaal.bron]}
            </span>
          </span>
        </div>
      </div>
    </motion.li>
  );
}

export function CitationBadge({
  children,
  inline = false,
}: {
  children: React.ReactNode;
  inline?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md bg-pavo-teal/10 font-bold text-pavo-teal ${
        inline ? "px-1.5 py-0.5 text-[11px]" : "min-w-[22px] px-1 py-0.5 text-[11px]"
      }`}
    >
      {children}
    </span>
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

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 10.5 8 14.5 16 6" />
    </svg>
  );
}

function EyeIcon({ className = "" }: { className?: string }) {
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
      <path d="M10 4.5C5.5 4.5 2 10 2 10s3.5 5.5 8 5.5S18 10 18 10s-3.5-5.5-8-5.5z" />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  );
}
