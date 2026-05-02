"use client";

import Link from "next/link";
import { useState } from "react";
import type { AppUser } from "@/lib/auth/server";
import NotificationBell from "./NotificationBell";

type Props = {
  user: AppUser | null;
};

export default function HeaderAuth({ user }: Props) {
  const [busy, setBusy] = useState(false);

  if (!user) {
    return (
      <span className="hidden items-center gap-1.5 rounded-full border border-pavo-ink/[0.06] bg-white/60 px-2.5 py-1 text-[11px] font-medium text-pavo-gray-600 sm:inline-flex">
        Powered by FactumAI
      </span>
    );
  }

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
      window.location.href = "/login";
    } finally {
      setBusy(false);
    }
  }

  const display = user.fullName ?? user.email;

  return (
    <div className="flex items-center gap-2 md:gap-2.5">
      <NotificationBell enabled />

      <div className="hidden items-center gap-2 rounded-full border border-pavo-ink/[0.08] bg-white/70 py-1 pl-1 pr-2.5 backdrop-blur-sm md:inline-flex">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pavo-teal to-pavo-navy text-[11px] font-bold text-white">
          {initials(display)}
        </span>
        <span className="flex flex-col leading-tight">
          <span className="max-w-[170px] truncate text-[12px] font-semibold text-pavo-gray-900">
            {display}
          </span>
          <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-pavo-gray-600">
            {user.role}
          </span>
        </span>
      </div>

      <Link
        href="/users"
        className="rounded-full border border-pavo-ink/[0.08] bg-white/70 px-2.5 py-1.5 text-[11px] font-semibold text-pavo-gray-900 transition-colors hover:border-pavo-teal/40 hover:text-pavo-teal md:hidden"
      >
        Users
      </Link>

      <button
        type="button"
        onClick={handleSignOut}
        disabled={busy}
        className="rounded-full border border-pavo-ink/[0.08] bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-pavo-gray-900 transition-colors hover:border-pavo-teal/40 hover:text-pavo-teal disabled:opacity-50"
      >
        {busy ? "Uitloggen…" : "Uitloggen"}
      </button>
    </div>
  );
}

function initials(name: string) {
  // Pak voorletters van de eerste twee woorden, of de eerste 2 chars
  // van het email-localpart wanneer we alleen een email hebben.
  const cleaned = name.includes("@") ? (name.split("@")[0] ?? name) : name;
  const parts = cleaned.split(/[\s.\-_]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}
