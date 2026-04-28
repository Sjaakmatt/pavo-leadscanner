"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

type Props = {
  kvk: string;
  fallbackObservatie: string;
};

type Status = "loading" | "streaming" | "done" | "fallback";

// Bump deze suffix als de briefing-prompt verandert — oude cached
// briefings missen dan de nieuwste structuur (bijv. [N]-citaties).
const CACHE_PREFIX = "pavo:brief:v3-bullets:";

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
        className="text-sm leading-relaxed text-pavo-gray-900 md:text-[15px]"
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
        className="space-y-1.5 text-sm leading-relaxed text-pavo-gray-900 md:text-[15px]"
      >
        {bulletBuffer.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span
              aria-hidden
              className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-pavo-teal"
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
        className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-pavo-gray-900 md:text-[15px]"
      >
        {numberedBuffer.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
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
          className="mt-4 text-xs font-semibold uppercase tracking-wide text-pavo-teal first:mt-0"
        >
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
    el.classList.add("ring-2", "ring-pavo-teal", "rounded-lg");
    setTimeout(() => {
      el.classList.remove("ring-2", "ring-pavo-teal", "rounded-lg");
    }, 1200);
  };

  return (
    <span className="mx-0.5 inline-flex items-center gap-0.5 align-baseline">
      {nums.map((n, i) => (
        <a
          key={i}
          href={`#signaal-${n}`}
          onClick={(e) => handleClick(e, n)}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded bg-pavo-teal/10 px-1 text-[10px] font-semibold text-pavo-teal transition-colors hover:bg-pavo-teal hover:text-white"
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
