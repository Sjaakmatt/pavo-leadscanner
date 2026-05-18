"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { stripToolTranscripts } from "@/lib/agent/output-sanitize";

type Props = {
  kvk: string;
  fallbackObservatie: string;
};

type Status = "loading" | "streaming" | "done" | "fallback";

// Bump deze suffix als de briefing-prompt verandert — oude cached
// briefings missen dan de nieuwste structuur.
const CACHE_PREFIX = "pavo:brief:v4-no-tools:";

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
      setText(stripToolTranscripts(cached));
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
          setText(stripToolTranscripts(acc));
        }
        acc += decoder.decode();
        if (cancelled) return;
        const cleaned = stripToolTranscripts(acc);
        setText(cleaned);
        setStatus("done");

        if (typeof window !== "undefined" && cleaned.length > 0) {
          window.sessionStorage.setItem(CACHE_PREFIX + kvk, cleaned);
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
    <section className="relative overflow-hidden rounded-2xl border border-pavo-orange/20 bg-gradient-to-br from-pavo-orange/[0.06] via-white to-white p-5 shadow-card md:p-7">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-pavo-orange/15 blur-3xl"
      />

      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-pavo-orange to-pavo-coral shadow-[0_2px_8px_-2px_rgba(232,117,68,0.4)]">
            <LightbulbIcon className="h-3.5 w-3.5 text-white" />
          </span>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pavo-orange">
            Briefing van de agent
          </h2>
        </div>
        {status === "streaming" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-pavo-teal/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pavo-teal">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pavo-teal" />
            Live synthese
          </span>
        )}
        {status === "fallback" && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-pavo-gray-600">
            Snapshot
          </span>
        )}
      </div>

      <div className="relative mt-4 rounded-xl bg-white/70 p-5 ring-1 ring-pavo-ink/[0.04] backdrop-blur-sm">
        <AnimatePresence mode="wait">
          {status === "loading" && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="space-y-2.5"
            >
              <div className="h-3.5 w-2/3 animate-pulse rounded-full bg-pavo-orange/10" />
              <div className="h-3.5 w-full animate-pulse rounded-full bg-pavo-orange/10" />
              <div className="h-3.5 w-5/6 animate-pulse rounded-full bg-pavo-orange/10" />
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
              className="text-sm leading-relaxed text-pavo-navy"
            >
              {fallbackObservatie}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

// Rendert onze minimale markdown-subset:
//   - `## kop`  → section-header
//   - `- text`  → bullet
//   - `1. text` → genummerde lijst (legacy)
//   - paragraaf (legacy)
//   - inline `**bold**` → <strong>
//   - inline [N] / [N,M] → klikbare citatie-pills (scroll naar #signaal-N)
//
// Claude krijgt een strakke template dus we weten wat we tegenkomen
// (zie BRIEFING_USER_PROMPT in lib/claude.ts).
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
  let bulletBuffer: string[] = [];
  let numberedBuffer: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    nodes.push(
      <p
        key={`p-${key++}`}
        className="text-[15px] leading-relaxed text-pavo-navy md:text-base"
      >
        {renderInline(paragraphBuffer.join(" "))}
      </p>,
    );
    paragraphBuffer = [];
  };

  const flushBullets = () => {
    if (bulletBuffer.length === 0) return;
    nodes.push(
      <ul
        key={`ul-${key++}`}
        className="space-y-2 text-[15px] leading-relaxed text-pavo-navy md:text-base"
      >
        {bulletBuffer.map((item, i) => (
          <li key={i} className="flex gap-3">
            <span
              aria-hidden
              className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-pavo-orange"
            />
            <span className="min-w-0 flex-1">{renderInline(item)}</span>
          </li>
        ))}
      </ul>,
    );
    bulletBuffer = [];
  };

  const flushNumbered = () => {
    if (numberedBuffer.length === 0) return;
    nodes.push(
      <ol
        key={`ol-${key++}`}
        className="space-y-2 text-[15px] leading-relaxed text-pavo-navy md:text-base"
      >
        {numberedBuffer.map((item, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-pavo-orange/10 font-mono text-[10px] font-bold text-pavo-orange">
              {i + 1}
            </span>
            <span>{renderInline(item)}</span>
          </li>
        ))}
      </ol>,
    );
    numberedBuffer = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flushParagraph();
      flushBullets();
      flushNumbered();
      nodes.push(
        <h3
          key={`h-${key++}`}
          className="mt-5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-pavo-orange first:mt-0"
        >
          <span className="h-px w-4 bg-pavo-orange/40" />
          {line.slice(3).trim()}
        </h3>,
      );
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      flushNumbered();
      bulletBuffer.push(bullet[1]);
      continue;
    }
    const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      flushBullets();
      numberedBuffer.push(numbered[2]);
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushBullets();
      flushNumbered();
      continue;
    }
    flushBullets();
    flushNumbered();
    paragraphBuffer.push(line);
  }
  flushParagraph();
  flushBullets();
  flushNumbered();

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

// Combineer **bold** + [N]-citaties in één pass over een regel.
function renderInline(raw: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Splits eerst op **bold**-tokens. Wat overblijft kan citation-pills bevatten.
  const boldRe = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(raw)) !== null) {
    if (m.index > last) {
      parts.push(
        ...renderInlineWithCitations(raw.slice(last, m.index)).map(
          (n, i) => <span key={`pre-${key++}-${i}`}>{n}</span>,
        ),
      );
    }
    parts.push(
      <strong key={`b-${key++}`} className="font-semibold text-pavo-navy">
        {renderInlineWithCitations(m[1])}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    parts.push(
      ...renderInlineWithCitations(raw.slice(last)).map((n, i) => (
        <span key={`tail-${key++}-${i}`}>{n}</span>
      )),
    );
  }
  return parts;
}

// Vervangt [N] en [N,M,...] patronen in een tekst door klikbare pills
// die naar #signaal-N scrollen. Rest van de tekst blijft platte string.
function renderInlineWithCitations(raw: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(raw)) !== null) {
    if (match.index > lastIdx) {
      parts.push(raw.slice(lastIdx, match.index));
    }
    const nums = match[1].split(/\s*,\s*/).map((n) => parseInt(n, 10));
    parts.push(
      <CitationPill key={`c-${key++}`} nums={nums} />,
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < raw.length) parts.push(raw.slice(lastIdx));
  return parts;
}

function CitationPill({ nums }: { nums: number[] }) {
  const handleClick = (e: React.MouseEvent, n: number) => {
    e.preventDefault();
    if (typeof window === "undefined") return;
    const el = document.getElementById(`signaal-${n}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Korte highlight-flash
    el.classList.add("ring-2", "ring-pavo-teal", "rounded-xl");
    setTimeout(() => {
      el.classList.remove("ring-2", "ring-pavo-teal", "rounded-xl");
    }, 1200);
  };

  return (
    <span className="mx-0.5 inline-flex items-center gap-0.5 align-baseline">
      {nums.map((n, i) => (
        <a
          key={i}
          href={`#signaal-${n}`}
          onClick={(e) => handleClick(e, n)}
          className="inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-md bg-pavo-teal/10 px-1 text-[10px] font-bold text-pavo-teal transition-all duration-200 hover:scale-110 hover:bg-pavo-teal hover:text-white"
          title={`Spring naar signaal ${n}`}
        >
          {n}
        </a>
      ))}
    </span>
  );
}

function LightbulbIcon({ className = "" }: { className?: string }) {
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
      <path d="M10 2.5a5.5 5.5 0 0 0-3.3 9.9c.5.4.8 1 .8 1.6v.5h5v-.5c0-.6.3-1.2.8-1.6A5.5 5.5 0 0 0 10 2.5Z" />
      <path d="M8 17h4" />
    </svg>
  );
}
