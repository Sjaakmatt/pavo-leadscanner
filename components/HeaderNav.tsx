"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { prefetch } from "@/lib/hooks/use-cached-fetch";
import { PREFETCH_FETCHERS } from "@/lib/hooks/fetchers";

export type NavItem = {
  href: string;
  label: string;
};

// Client-component voor de hoofdnavigatie zodat we het actieve tabblad
// kunnen highlighten (usePathname is hook-only) én op hover de data
// alvast kunnen prefetchen.
export default function HeaderNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const router = useRouter();

  const onHover = useCallback(
    (href: string) => {
      // 1. Next-route prefetch — pakt de RSC payload alvast op.
      router.prefetch(href);
      // 2. Data prefetch — gebruikt EXACT dezelfde fetcher als de page-
      //    component, anders staat er straks een raw response in cache
      //    die de page niet kan unwrappen.
      const entry = PREFETCH_FETCHERS[href];
      if (entry) prefetch(entry.key, entry.fetcher);
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
