"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = {
  href: string;
  label: string;
};

// Client-component voor de hoofdnavigatie zodat we het actieve tabblad
// kunnen highlighten (usePathname is hook-only). Server-component
// Header bepaalt welke items mogen op basis van auth/role en geeft
// alleen een veilige lijst door.
export default function HeaderNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
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
