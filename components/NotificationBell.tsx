"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Notification = {
  id: string;
  title: string;
  body: string | null;
  kvk: string | null;
  type: string;
  read_at: string | null;
  created_at: string;
};

// Bell met badge voor het aantal ongelezen notificaties. Polled iedere
// 60s; geen websockets nodig voor dit volume. Klik opent een dropdown
// die de eerste 10 toont; "alles als gelezen" markeert alles in één
// call.
export default function NotificationBell({ enabled }: { enabled: boolean }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/notifications?all=1", {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as {
          notifications: Notification[];
          unread: number;
        };
        if (cancelled) return;
        setItems(body.notifications);
        setUnread(body.unread);
      } catch {
        // silent
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);

  if (!enabled) return null;

  async function markAllRead() {
    await fetch("/api/notifications", { method: "POST" });
    setItems((curr) =>
      curr.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })),
    );
    setUnread(0);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-pavo-ink/[0.08] bg-white/70 text-pavo-gray-600 backdrop-blur-sm transition-colors hover:border-pavo-teal/40 hover:text-pavo-teal"
        aria-label="Meldingen"
      >
        <BellIcon className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gradient-to-br from-pavo-orange to-pavo-coral px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-2xl border border-pavo-ink/[0.06] bg-white p-2 shadow-card-lg">
          <div className="flex items-center justify-between border-b border-pavo-gray-100 px-2 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
              Meldingen
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-[11px] text-pavo-teal hover:underline"
              >
                Alles markeren als gelezen
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="p-3 text-xs text-pavo-gray-600">
                Geen meldingen.
              </p>
            ) : (
              <ul className="divide-y divide-pavo-gray-100">
                {items.slice(0, 10).map((n) => (
                  <li key={n.id} className="px-2 py-2">
                    {n.kvk ? (
                      <Link
                        href={`/lead/${n.kvk}`}
                        onClick={() => setOpen(false)}
                        className="block hover:bg-pavo-gray-50"
                      >
                        <NotifContent n={n} />
                      </Link>
                    ) : (
                      <NotifContent n={n} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotifContent({ n }: { n: Notification }) {
  return (
    <div className={n.read_at ? "opacity-70" : ""}>
      <p className="text-xs font-medium text-pavo-gray-900">
        {!n.read_at && (
          <span
            aria-hidden
            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-pavo-orange align-middle"
          />
        )}
        {n.title}
      </p>
      {n.body && (
        <p className="mt-0.5 line-clamp-2 text-[11px] text-pavo-gray-600">
          {n.body}
        </p>
      )}
      <p className="mt-1 text-[10px] text-pavo-gray-600/70">
        {new Date(n.created_at).toLocaleString("nl-NL", {
          dateStyle: "short",
          timeStyle: "short",
        })}
      </p>
    </div>
  );
}

function BellIcon({ className = "" }: { className?: string }) {
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
      <path d="M5 14h10l-1.5-2v-3.5a3.5 3.5 0 1 0-7 0V12z" />
      <path d="M8 16.5a2 2 0 0 0 4 0" />
    </svg>
  );
}
