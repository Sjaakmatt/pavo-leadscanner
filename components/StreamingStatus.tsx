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
    <div className="overflow-hidden rounded-lg border border-pavo-gray-100 bg-white shadow-sm">
      <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
        {!done ? (
          <>
            <Spinner />
            <AnimatePresence mode="wait">
              <motion.span
                key={visible}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="truncate text-pavo-gray-900"
              >
                {current?.text}
              </motion.span>
            </AnimatePresence>
            <span className="ml-auto shrink-0 text-xs tabular-nums text-pavo-gray-600">
              {visible}/{steps.length}
            </span>
          </>
        ) : (
          <>
            <CheckIcon className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="truncate text-pavo-gray-600">
              Analyse voltooid · {steps.length} stappen doorlopen
            </span>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="ml-auto shrink-0 text-xs font-medium text-pavo-teal transition-colors hover:text-pavo-teal-dark"
            >
              {expanded ? "Verberg stappen" : "Toon stappen"}
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
            className="h-0.5 w-full bg-pavo-gray-100"
          >
            {progressPct === undefined ? (
              <motion.div
                className="h-full w-1/3 bg-pavo-teal"
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
                className="h-full bg-pavo-teal"
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
            transition={{ duration: 0.2 }}
            className="border-t border-pavo-gray-100 px-4 py-3"
          >
            {steps.map((s, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 py-0.5 text-xs text-pavo-gray-600"
              >
                <CheckIcon className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                <span>{s.text}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-pavo-teal/20 border-t-pavo-teal"
    />
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 10.5 8 14.5 16 6" />
    </svg>
  );
}
