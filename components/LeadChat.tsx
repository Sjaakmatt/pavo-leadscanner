"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

type ChatMessage = { role: "user" | "assistant"; content: string };

type Props = {
  kvk: string;
  leadNaam: string;
  open: boolean;
  onClose: () => void;
};

export default function LeadChat({ kvk, leadNaam, open, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset de chat wanneer we naar een andere lead kijken
  useEffect(() => {
    setMessages([]);
    setInput("");
    setError(null);
    abortRef.current?.abort();
  }, [kvk]);

  // Escape sluit de drawer
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Auto-scroll naar onderkant bij nieuwe tekst
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const newHistory: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ];
    setMessages(newHistory);
    setInput("");
    setStreaming(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/chat/${kvk}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          // Stuur alles behalve het lege placeholder-assistant-bericht
          messages: newHistory.slice(0, -1),
        }),
      });

      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `Server gaf status ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((curr) => {
          const next = [...curr];
          next[next.length - 1] = { role: "assistant", content: acc };
          return next;
        });
      }
      acc += decoder.decode();
      setMessages((curr) => {
        const next = [...curr];
        next[next.length - 1] = { role: "assistant", content: acc };
        return next;
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Onbekende fout";
      setError(msg);
      // Trek de lege assistant-placeholder weer weg
      setMessages((curr) =>
        curr[curr.length - 1]?.role === "assistant" && curr[curr.length - 1].content === ""
          ? curr.slice(0, -1)
          : curr,
      );
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, streaming, messages, kvk]);

  const suggested = [
    "Wat is het belangrijkste pijnpunt hier?",
    "Hoe zou het eerste gesprek eruitzien?",
    "Welke vacature staat het langst open?",
  ];

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-pavo-navy/40 backdrop-blur-md"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.aside
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            className="fixed right-0 top-0 z-50 flex h-dvh w-full flex-col bg-pavo-cream shadow-2xl sm:w-[480px]"
            role="dialog"
            aria-label={`Chat met research-agent over ${leadNaam}`}
          >
            <header className="relative flex items-start justify-between gap-3 border-b border-pavo-ink/[0.06] bg-gradient-to-br from-pavo-navy via-pavo-navy-soft to-pavo-teal-dark px-5 py-4 text-white">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-pavo-teal-bright/30 blur-3xl"
              />
              <div className="relative min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/10 ring-1 ring-white/20">
                    <SparkIcon className="h-3.5 w-3.5 text-white" />
                  </span>
                  <h2 className="text-sm font-semibold tracking-tight">
                    Vraag de research-agent
                  </h2>
                </div>
                <p className="mt-1 truncate text-xs text-white/70">
                  Over: <span className="font-medium text-white/90">{leadNaam}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="relative -m-1 rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Chat sluiten"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </header>

            <div
              ref={scrollRef}
              className="flex-1 space-y-4 overflow-y-auto px-5 py-5"
            >
              {messages.length === 0 && (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-pavo-ink/[0.06] bg-white p-4 text-sm leading-relaxed text-pavo-navy shadow-card">
                    <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-pavo-teal/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pavo-teal">
                      Welkom
                    </span>
                    <p>
                      Ik heb de analyse van <strong>{leadNaam}</strong> paraat.
                      Vraag me gerust door — over de signalen, archetype,
                      passende PAVO-diensten of hoe je het eerste gesprek zou
                      aanpakken.
                    </p>
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-pavo-gray-600">
                      Voorbeeld-vragen
                    </p>
                    <div className="flex flex-col gap-2">
                      {suggested.map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => {
                            setInput(q);
                          }}
                          className="group flex items-center justify-between gap-2 rounded-xl border border-pavo-ink/[0.06] bg-white px-3.5 py-2.5 text-left text-sm font-medium text-pavo-navy transition-all duration-200 hover:-translate-y-px hover:border-pavo-teal/40 hover:shadow-card"
                        >
                          <span>{q}</span>
                          <ArrowIcon className="h-3.5 w-3.5 shrink-0 text-pavo-gray-600 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-pavo-teal" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <MessageBubble
                  key={i}
                  role={m.role}
                  content={m.content}
                  pending={
                    streaming &&
                    i === messages.length - 1 &&
                    m.role === "assistant" &&
                    m.content.length === 0
                  }
                />
              ))}

              {error && (
                <div className="rounded-xl border border-pavo-orange/30 bg-pavo-orange/5 px-3 py-2 text-xs text-pavo-navy">
                  <strong className="text-pavo-orange">Fout: </strong>
                  {error}
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="border-t border-pavo-ink/[0.06] bg-white p-3"
            >
              <div className="flex items-end gap-2 rounded-xl border border-pavo-ink/[0.08] bg-white p-1.5 transition-all duration-200 focus-within:border-pavo-teal focus-within:ring-4 focus-within:ring-pavo-teal/10">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  rows={2}
                  placeholder="Vraag iets over deze lead…"
                  disabled={streaming}
                  className="flex-1 resize-none border-0 bg-transparent px-2.5 py-2 text-sm text-pavo-navy placeholder:text-pavo-gray-600/60 focus:outline-none disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={streaming || !input.trim()}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-pavo-orange to-pavo-coral text-white shadow-[0_4px_12px_-4px_rgba(232,117,68,0.5)] transition-all duration-200 hover:shadow-[0_6px_18px_-4px_rgba(232,117,68,0.6)] disabled:cursor-not-allowed disabled:from-pavo-gray-100 disabled:to-pavo-gray-100 disabled:text-pavo-gray-600 disabled:shadow-none"
                  aria-label="Verstuur"
                >
                  {streaming ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-white/30 border-t-white" />
                  ) : (
                    <SendIcon className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="mt-2 px-1 text-[11px] text-pavo-gray-600">
                Enter verstuurt · Shift+Enter voor nieuwe regel
              </p>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function MessageBubble({
  role,
  content,
  pending,
}: {
  role: "user" | "assistant";
  content: string;
  pending: boolean;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-pavo-teal to-pavo-navy px-3.5 py-2.5 text-sm leading-relaxed text-white shadow-[0_4px_12px_-4px_rgba(15,62,71,0.4)]">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end justify-start gap-2">
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-pavo-orange to-pavo-coral shadow-[0_2px_8px_-2px_rgba(232,117,68,0.4)]">
        <SparkIcon className="h-3 w-3 text-white" />
      </span>
      <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-pavo-ink/[0.06] bg-white px-3.5 py-2.5 text-sm text-pavo-navy shadow-card">
        {pending ? <TypingDots /> : <p className="whitespace-pre-wrap leading-relaxed">{content}</p>}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0.3 }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.15,
            ease: "easeInOut",
          }}
          className="h-1.5 w-1.5 rounded-full bg-pavo-teal"
        />
      ))}
    </span>
  );
}

function SparkIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M10 1.5l1.4 4.2 4.2 1.4-4.2 1.4L10 12.7l-1.4-4.2L4.4 7.1 8.6 5.7 10 1.5zM15.5 12l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
    </svg>
  );
}

function CloseIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

function SendIcon({ className = "" }: { className?: string }) {
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
      <path d="M3 10 17 3l-5 14-2.5-6z" />
    </svg>
  );
}

function ArrowIcon({ className = "" }: { className?: string }) {
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
      <path d="M4 10h12M11 5l5 5-5 5" />
    </svg>
  );
}
