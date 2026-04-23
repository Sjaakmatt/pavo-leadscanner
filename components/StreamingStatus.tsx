"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

export type StreamStep = { text: string; delay: number };

type Props = {
  steps: StreamStep[];
  onComplete?: () => void;
  // When true the card renders as a completed/collapsable summary after finishing.
  collapseWhenDone?: boolean;
};

export default function StreamingStatus({
  steps,
  onComplete,
  collapseWhenDone = true,
}: Props) {
  const [visible, setVisible] = useState<number>(0);
  const [done, setDone] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setVisible(0);
    setDone(false);
    setCollapsed(false);
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

    // kick off the first line after a short initial beat
    const first = setTimeout(next, 200);
    return () => {
      cancelled = true;
      clearTimeout(first);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  if (steps.length === 0) return null;

  const shown = steps.slice(0, visible);

  return (
    <div className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-pavo-teal">
          {!done ? (
            <span className="h-2 w-2 animate-pulse rounded-full bg-pavo-teal" />
          ) : (
            <CheckIcon className="h-4 w-4 text-pavo-teal" />
          )}
          {done
            ? `${steps.length} stappen voltooid`
            : "Agent werkt aan je zoekopdracht"}
        </div>
        {done && collapseWhenDone && (
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="text-xs text-pavo-gray-600 hover:text-pavo-teal"
          >
            {collapsed ? "Toon stappen ▾" : "Verberg stappen ▴"}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {(!done || !collapsed) && (
          <motion.ul
            key="list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-4 space-y-2 overflow-hidden"
          >
            {shown.map((s, idx) => {
              const isLastVisible = idx === shown.length - 1;
              const isCompleted = done || !isLastVisible;
              return (
                <motion.li
                  key={`${idx}-${s.text}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="flex items-start gap-3 text-sm"
                >
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                    {isCompleted ? (
                      <CheckIcon className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-pavo-teal" />
                    )}
                  </span>
                  <span
                    className={
                      isCompleted
                        ? "text-pavo-gray-600"
                        : "text-pavo-gray-900"
                    }
                  >
                    {s.text}
                  </span>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
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
