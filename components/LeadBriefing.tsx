"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

type Props = {
  kvk: string;
  fallbackObservatie: string;
};

type Status = "loading" | "streaming" | "done" | "fallback";

const CACHE_PREFIX = "pavo:brief:";

// Richer synthesis streamed from Claude. We cache per kvk in
// sessionStorage so flipping between leads feels instant and a demo
// doesn't re-bill the same briefing.
export default function LeadBriefing({ kvk, fallbackObservatie }: Props) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;

    // Check session cache first
    const cached =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem(CACHE_PREFIX + kvk)
        : null;
    if (cached) {
      setText(cached);
      setStatus("done");
      return;
    }

    setText("");
    setStatus("loading");

    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/brief/${kvk}`, {
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`status ${res.status}`);
        }
        setStatus("streaming");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (cancelled) return;
          acc += decoder.decode(value, { stream: true });
          setText(acc);
        }
        acc += decoder.decode();
        if (cancelled) return;
        setText(acc);
        setStatus("done");

        if (typeof window !== "undefined" && acc.length > 0) {
          window.sessionStorage.setItem(CACHE_PREFIX + kvk, acc);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (cancelled) return;
        setStatus("fallback");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [kvk]);

  return (
    <section className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LightbulbIcon className="h-4 w-4 text-pavo-orange" />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
            Briefing van de agent
          </h2>
        </div>
        {status === "streaming" && (
          <span className="flex items-center gap-1.5 text-xs text-pavo-gray-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pavo-teal" />
            Live synthese
          </span>
        )}
        {status === "fallback" && (
          <span className="text-xs text-pavo-gray-600">
            Samenvatting uit snapshot
          </span>
        )}
      </div>

      <div className="mt-3 rounded-lg bg-pavo-gray-50 p-4">
        <AnimatePresence mode="wait">
          {status === "loading" && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="space-y-2"
            >
              <div className="h-3 w-2/3 animate-pulse rounded bg-pavo-gray-100" />
              <div className="h-3 w-full animate-pulse rounded bg-pavo-gray-100" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-pavo-gray-100" />
              <p className="pt-2 text-xs text-pavo-gray-600">
                De agent schrijft een briefing…
              </p>
            </motion.div>
          )}

          {(status === "streaming" || status === "done") && (
            <motion.div
              key="brief"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
            >
              <BriefingMarkdown text={text} streaming={status === "streaming"} />
            </motion.div>
          )}

          {status === "fallback" && (
            <motion.p
              key="fallback"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="text-sm leading-relaxed text-pavo-gray-900"
            >
              {fallbackObservatie}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

// Rendert onze minimale markdown-subset: `## kop`, genummerde lijsten
// (`1. …`) en paragrafen. Geen algemene markdown-parser nodig — Claude
// krijgt een strakke template dus we weten wat we tegenkomen.
function BriefingMarkdown({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const nodes: React.ReactNode[] = [];
  const lines = text.split("\n");
  let paragraphBuffer: string[] = [];
  let listBuffer: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    nodes.push(
      <p
        key={`p-${key++}`}
        className="text-sm leading-relaxed text-pavo-gray-900 md:text-[15px]"
      >
        {paragraphBuffer.join(" ")}
      </p>,
    );
    paragraphBuffer = [];
  };

  const flushList = () => {
    if (listBuffer.length === 0) return;
    nodes.push(
      <ol
        key={`ol-${key++}`}
        className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-pavo-gray-900 md:text-[15px]"
      >
        {listBuffer.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ol>,
    );
    listBuffer = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      nodes.push(
        <h3
          key={`h-${key++}`}
          className="mt-4 text-xs font-semibold uppercase tracking-wide text-pavo-teal first:mt-0"
        >
          {line.slice(3).trim()}
        </h3>,
      );
      continue;
    }
    const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      listBuffer.push(numbered[2]);
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraphBuffer.push(line);
  }
  flushParagraph();
  flushList();

  if (streaming) {
    nodes.push(
      <span
        key="cursor"
        className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-pavo-teal align-middle"
        aria-hidden
      />,
    );
  }

  return <div className="space-y-3">{nodes}</div>;
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
