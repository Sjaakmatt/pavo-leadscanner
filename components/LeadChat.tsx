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
            className="fixed inset-0 z-40 bg-pavo-gray-900/20 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.aside
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="fixed right-0 top-0 z-50 flex h-dvh w-full flex-col bg-white shadow-2xl sm:w-[480px]"
            role="dialog"
            aria-label={`Chat met research-agent over ${leadNaam}`}
          >
            <header className="flex items-start justify-between gap-3 border-b border-pavo-gray-100 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <SparkIcon className="h-4 w-4 text-pavo-teal" />
                  <h2 className="text-sm font-semibold text-pavo-navy">
                    Vraag de research-agent
                  </h2>
                </div>
                <p className="mt-0.5 truncate text-xs text-pavo-gray-600">
                  Over: {leadNaam}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="-m-1 rounded p-1 text-pavo-gray-600 transition-colors hover:bg-pavo-gray-50 hover:text-pavo-gray-900"
                aria-label="Chat sluiten"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </header>

            <div
              ref={scrollRef}
              className="flex-1 space-y-4 overflow-y-auto px-5 py-4"
            >
              {messages.length === 0 && (
                <div className="space-y-4">
                  <div className="rounded-lg bg-pavo-gray-50 p-4 text-sm leading-relaxed text-pavo-gray-900">
                    Ik heb de analyse van <strong>{leadNaam}</strong> paraat.
                    Vraag me gerust door — over de signalen, archetype,
                    passende PAVO-diensten of hoe je het eerste gesprek zou
                    aanpakken.
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
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
                          className="rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-left text-sm text-pavo-gray-900 transition-all duration-200 hover:border-pavo-teal hover:text-pavo-teal"
                        >
                          {q}
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
                <div className="rounded-lg border border-pavo-orange/30 bg-pavo-orange/5 px-3 py-2 text-xs text-pavo-gray-900">
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
              className="border-t border-pavo-gray-100 p-3"
            >
              <div className="flex items-end gap-2">
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
                  className="flex-1 resize-none rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 transition-all duration-200 placeholder:text-pavo-gray-600/60 focus:border-pavo-teal focus:outline-none disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={streaming || !input.trim()}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-pavo-teal px-4 text-sm font-semibold text-white transition-all duration-200 hover:bg-pavo-teal-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {streaming ? (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <SendIcon className="h-4 w-4" />
                  )}
                  <span>Stuur</span>
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-pavo-gray-600">
                Enter verstuurt · Shift+Enter voor nieuwe regel · Antwoorden
                komen van Claude Sonnet 4.6
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
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-pavo-teal px-3 py-2 text-sm text-white">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-lg rounded-bl-sm border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 shadow-sm">
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
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M10 2v4M10 14v4M2 10h4M14 10h4M4.5 4.5l2.8 2.8M12.7 12.7l2.8 2.8M15.5 4.5l-2.8 2.8M7.3 12.7l-2.8 2.8" />
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
