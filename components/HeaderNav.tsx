"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { prefetch } from "@/lib/hooks/use-cached-fetch";

export type NavItem = {
  href: string;
  label: string;
};

// Welke API-call hoort bij welke tab — gebruikt voor on-hover prefetch
// zodat data al onderweg is wanneer de gebruiker daadwerkelijk klikt.
const PREFETCH_API: Record<string, string> = {
  "/searches": "/api/searches",
  "/pipeline": "/api/lead-status",
  "/search-jobs": "/api/search-jobs",
  "/users": "/api/users",
  "/admin/searches": "/api/searches",
  "/admin/calibration": "/api/calibration",
};

// Client-component voor de hoofdnavigatie zodat we het actieve tabblad
// kunnen highlighten (usePathname is hook-only) én op hover de data
// alvast kunnen prefetchen.
export default function HeaderNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const router = useRouter();

  const onHover = useCallback(
    (href: string) => {
      // 1. Next-route prefetch (default Link doet dit ook on viewport,
      //    expliciete trigger op hover is nóg sneller).
      router.prefetch(href);
      // 2. Data prefetch — we hydrateren de cache zodat de page-mount
      //    direct rendert.
      const apiUrl = PREFETCH_API[href];
      if (apiUrl) {
        prefetch(apiUrl, () =>
          fetch(apiUrl, { cache: "no-store" }).then((r) =>
            r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`)),
          ),
        );
      }
    },
    [router],
  );

  return (
    <nav
      className="-mx-px mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 md:px-8"
      aria-label="Hoofdnavigatie"
    >
      {items.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onMouseEnter={() => onHover(item.href)}
            onFocus={() => onHover(item.href)}
            onTouchStart={() => onHover(item.href)}
            className={`relative shrink-0 px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "text-pavo-teal"
                : "text-pavo-gray-600 hover:text-pavo-navy"
            }`}
          >
            {item.label}
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-3 -bottom-px h-[2px] rounded-t-full bg-pavo-teal"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
