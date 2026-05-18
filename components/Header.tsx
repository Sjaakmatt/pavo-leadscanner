import Link from "next/link";
import ModeBadge from "./ModeBadge";
import HeaderAuth from "./HeaderAuth";
import HeaderNav, { type NavItem } from "./HeaderNav";
import { authConfigured, getCurrentUser } from "@/lib/auth/server";

export default async function Header() {
  const user = authConfigured() ? await getCurrentUser() : null;

  // Tabs blijven in zowel demo als prod zichtbaar zodat de UI niet
  // verwarrend springt. In demo-mode geven de prod-only API's empty
  // arrays terug (zie middleware) zodat geen prod-data lekt; pages tonen
  // dan hun bestaande "geen data"-state.
  const items: NavItem[] = [
    { href: "/", label: "Leads" },
    { href: "/searches", label: "Geschiedenis" },
    { href: "/pipeline", label: "Pipeline" },
    { href: "/search-jobs", label: "Jobs" },
  ];
  if (user) {
    items.push({ href: "/users", label: "Gebruikers" });
  }
  if (user?.role === "admin") {
    items.push(
      { href: "/admin/searches", label: "Observability" },
      { href: "/admin/calibration", label: "Calibration" },
    );
  }

  return (
    <header className="sticky top-0 z-30 border-b border-pavo-ink/[0.06] surface-glass">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-8 md:py-3.5">
        <div className="flex items-center gap-3 md:gap-4">
          <Link
            href="/"
            className="group inline-flex items-start gap-0.5"
            aria-label="PAVO HR — naar dashboard"
          >
            <PavoWordmark />
            <span className="-ml-0.5 mt-0.5 text-[10px] font-bold uppercase leading-none tracking-[0.04em] text-pavo-orange md:text-[11px]">
              HR
            </span>
          </Link>
          {user?.orgNaam && (
            <span
              className="hidden rounded-full border border-pavo-ink/[0.08] bg-white/70 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.10em] text-pavo-gray-600 md:inline-flex"
              title="Jouw organisatie"
            >
              {user.orgNaam}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <ModeBadge />
          <HeaderAuth user={user} />
        </div>
      </div>
      {(user || authConfigured()) && (
        <div className="border-t border-pavo-ink/[0.04]">
          <HeaderNav items={items} />
        </div>
      )}
    </header>
  );
}

// PAVO-wordmark — benadert de huisstijl: teal P-A-V-O met oranje swoosh
// in de "P". Vervangt de plain text-versie.
function PavoWordmark() {
  return (
    <svg
      viewBox="0 0 100 32"
      className="h-7 w-auto md:h-8"
      aria-hidden
    >
      <g>
        {/* P */}
        <path
          d="M2 4h11.5a8.5 8.5 0 0 1 0 17H7.5v7H2V4zm5.5 4.6v7.8h6a3.9 3.9 0 0 0 0-7.8h-6z"
          fill="#1B5F6C"
        />
        {/* arrow swoosh through P-counter */}
        <path
          d="M9.5 13.5l5.5-3-1.6 4.6"
          fill="none"
          stroke="#E87544"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* A */}
        <path
          d="M30.5 4h6L46 28h-5.6l-1.7-4.6h-9.4L27.6 28H22L30.5 4zm.6 14.8h6.5l-3.2-9.2-3.3 9.2z"
          fill="#1B5F6C"
        />
        {/* V */}
        <path
          d="M48 4h5.7l5.7 17 5.7-17H70.8L62 28h-5.4L48 4z"
          fill="#1B5F6C"
        />
        {/* O */}
        <path
          d="M85 3.5c7.2 0 12.4 5.4 12.4 12.5S92.2 28.5 85 28.5 72.6 23.1 72.6 16 77.8 3.5 85 3.5zm0 4.6c-4 0-6.8 3.3-6.8 7.9s2.8 7.9 6.8 7.9 6.8-3.3 6.8-7.9-2.8-7.9-6.8-7.9z"
          fill="#1B5F6C"
        />
      </g>
    </svg>
  );
}
