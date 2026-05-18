"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

export type StreamStep = { text: string; delay: number };

type Props = {
  steps: StreamStep[];
  onComplete?: () => void;
  // Als `live` = true: geen animatie-delays, nieuwste step is meteen
  // zichtbaar. Gebruik de `liveDone` prop om het "klaar"-frame te tonen.
  // Voor demo-mode (legacy pad) blijven we animeren met delays uit de
  // server-response.
  live?: boolean;
  liveDone?: boolean;
};

// Slim status bar. During streaming it shows a single ticker line with
// the current step; when finished it collapses to a quiet one-liner
// with an optional "Toon stappen" expander for power-users.
export default function StreamingStatus({ steps, onComplete, live, liveDone }: Props) {
  const [visible, setVisible] = useState(0);
  const [done, setDone] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Animated mode — steps come in as a static array at the start of the
  // search, we advance through them with random per-step delays.
  useEffect(() => {
    if (live) return;
    setVisible(0);
    setDone(false);
    setExpanded(false);
    if (steps.length === 0) return;

    let cancelled = false;
    let i = 0;
    function next() {
      if (cancelled) return;
      if (i >= steps.length) {
        setDone(true);
        onComplete?.();
        return;
      }
      setVisible(i + 1);
      const delay = steps[i].delay;
      i += 1;
      setTimeout(next, delay);
    }

    const first = setTimeout(next, 150);
    return () => {
      cancelled = true;
      clearTimeout(first);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, live]);

  // Live mode — elke keer dat `steps` of `liveDone` wijzigt, volgt de
  // ticker de laatste step. Callback-done draait op de externe flag.
  useEffect(() => {
    if (!live) return;
    setVisible(steps.length);
    if (liveDone) {
      setDone(true);
      onComplete?.();
    } else {
      setDone(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps.length, live, liveDone]);

  if (steps.length === 0 && !live) return null;

  const current = steps[Math.min(visible, steps.length) - 1];
  // In live-mode kennen we het eindtotaal niet — tonen we een
  // indeterminate progressbar (pulsing), anders percentage-based.
  const progressPct = live
    ? undefined
    : Math.round((visible / Math.max(steps.length, 1)) * 100);

  return (
    <div className="overflow-hidden rounded-2xl border border-pavo-ink/[0.06] bg-white/80 shadow-card backdrop-blur-sm">
      <div className="flex items-center gap-3 px-4 py-3 text-sm md:px-5">
        {!done ? (
          <>
            <PulseRing />
            <span className="hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-pavo-teal sm:inline">
              Agent
            </span>
            <span className="h-3 w-px bg-pavo-ink/[0.10]" />
            <AnimatePresence mode="wait">
              <motion.span
                key={visible}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="min-w-0 flex-1 truncate text-pavo-navy"
              >
                {current?.text}
              </motion.span>
            </AnimatePresence>
            <span className="ml-auto shrink-0 rounded-full bg-pavo-frost px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-pavo-gray-600">
              {visible}/{steps.length || "?"}
            </span>
          </>
        ) : (
          <>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckIcon className="h-3 w-3" />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
              Klaar
            </span>
            <span className="h-3 w-px bg-pavo-ink/[0.10]" />
            <span className="min-w-0 flex-1 truncate text-pavo-gray-600">
              {steps.length} stappen doorlopen
            </span>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-pavo-ink/[0.08] bg-white px-2.5 py-1 text-[11px] font-semibold text-pavo-teal transition-colors hover:border-pavo-teal/40 hover:bg-pavo-teal/5"
            >
              {expanded ? "Verberg" : "Toon"} stappen
              <ChevronIcon
                className={`h-3 w-3 transition-transform ${
                  expanded ? "rotate-180" : ""
                }`}
              />
            </button>
          </>
        )}
      </div>

      {/* Progress bar: kruipt tijdens streaming, verdwijnt bij afronden.
          In live-mode kennen we het totaal niet, dus pulseren we. */}
      <AnimatePresence>
        {!done && (
          <motion.div
            key="progress"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-[2px] w-full overflow-hidden bg-pavo-frost"
          >
            {progressPct === undefined ? (
              <motion.div
                className="h-full w-1/3 bg-gradient-to-r from-pavo-teal via-pavo-teal-bright to-pavo-teal"
                animate={{ x: ["-30%", "330%"] }}
                transition={{
                  duration: 1.8,
                  ease: "easeInOut",
                  repeat: Infinity,
                }}
              />
            ) : (
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="h-full bg-gradient-to-r from-pavo-teal to-pavo-teal-bright"
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Volledige stappenlijst — pas zichtbaar als expanded */}
      <AnimatePresence>
        {done && expanded && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="border-t border-pavo-ink/[0.06] bg-pavo-frost/40 px-5 py-3"
          >
            {steps.map((s, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 py-1 text-xs text-pavo-gray-600"
              >
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-pavo-teal/40" />
                <span>{s.text}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function PulseRing() {
  return (
    <span aria-hidden className="relative inline-flex h-2.5 w-2.5 shrink-0">
      <span className="absolute inset-0 animate-ping rounded-full bg-pavo-teal/40" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-pavo-teal" />
    </span>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 10.5 8 14.5 16 6" />
    </svg>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
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
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}
