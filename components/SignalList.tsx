"use client";

import { motion } from "motion/react";
import type { Bron, Signaal } from "@/lib/adapters/types";
import { bronSterkte } from "@/lib/claude";

const BRON_DESCRIPTIE: Record<Bron, string> = {
  KvK: "openbaar handelsregister",
  "KvK-historie": "historische mutaties (18 mnd)",
  "KvK-deponering": "jaarrekening-deponering",
  Jobdigger: "vacature-aggregator",
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
      className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm md:p-6"
    >
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
            {signalen.length === 1 ? "bron geraadpleegd" : "bronnen geraadpleegd"}
          </span>
        )}
      </div>

      {signalen.length === 0 ? (
        <p className="mt-3 text-sm text-pavo-gray-600">
          Geen significante HR-signalen gedetecteerd.
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs text-pavo-gray-600">
            De nummers worden in de briefing hierboven geciteerd als{" "}
            <CitationBadge inline>1</CitationBadge>.{" "}
            <span className="font-medium text-pavo-gray-900">Feitelijk</span>:
            register-data of aggregators die je kunt verifiëren.{" "}
            <span className="font-medium text-pavo-gray-900">
              Interpretatief
            </span>
            : gepubliceerde content waar de agent iets uit afleidt.
          </p>

          <ol className="mt-4 space-y-3">
            {signalen.map((s, i) => (
              <SignalRow key={i} signaal={s} index={i + 1} delay={i * 0.1} />
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
      className="flex items-start gap-3"
    >
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pavo-teal text-xs font-semibold text-white">
        {index}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed text-pavo-gray-900">
          {signaal.tekst}
        </p>

        {signaal.bewijs && signaal.bewijs.length > 0 && (
          <ul className="mt-2 space-y-1 border-l-2 border-pavo-gray-100 pl-3">
            {signaal.bewijs.slice(0, 3).map((quote, i) => (
              <li
                key={i}
                className="text-xs italic leading-snug text-pavo-gray-600"
              >
                &ldquo;{quote}&rdquo;
              </li>
            ))}
          </ul>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
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
            <span className="font-medium text-pavo-gray-900">
              {signaal.bron}
            </span>{" "}
            — {BRON_DESCRIPTIE[signaal.bron]}
          </span>
          {signaal.bronUrl && (
            <a
              href={signaal.bronUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 text-pavo-teal underline-offset-2 hover:underline"
            >
              bron openen
              <ExternalIcon className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </motion.li>
  );
}

function ExternalIcon({ className = "" }: { className?: string }) {
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
      <path d="M11 4h5v5M16 4l-7 7M9 6H5v9h9v-4" />
    </svg>
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
      className={`inline-flex items-center justify-center rounded-md bg-pavo-teal/10 font-semibold text-pavo-teal ${
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
