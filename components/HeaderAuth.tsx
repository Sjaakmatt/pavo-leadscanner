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
      <span className="text-xs text-pavo-gray-600">Powered by FactumAI</span>
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

  return (
    <div className="flex items-center gap-3">
      <NotificationBell enabled />
      <div className="hidden text-right md:block">
        <div className="text-xs font-medium text-pavo-gray-900">
          {user.fullName ?? user.email}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-pavo-gray-600">
          {user.role}
        </div>
      </div>
      <Link
        href="/users"
        className="rounded-md border border-pavo-gray-100 bg-white px-2 py-1 text-xs text-pavo-gray-900 transition-colors hover:border-pavo-teal hover:text-pavo-teal md:hidden"
      >
        Users
      </Link>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={busy}
        className="rounded-md border border-pavo-gray-100 bg-white px-2.5 py-1 text-xs text-pavo-gray-900 transition-colors hover:border-pavo-teal hover:text-pavo-teal disabled:opacity-50"
      >
        {busy ? "Uitloggen…" : "Uitloggen"}
      </button>
    </div>
  );
}
