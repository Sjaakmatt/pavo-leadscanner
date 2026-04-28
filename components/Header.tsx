import Link from "next/link";
import ModeBadge from "./ModeBadge";
import HeaderAuth from "./HeaderAuth";
import { authConfigured, getCurrentUser } from "@/lib/auth/server";

export default async function Header() {
  const user = authConfigured() ? await getCurrentUser() : null;
  return (
    <header className="border-b border-pavo-gray-100 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-6 md:py-4">
        <div className="flex items-center gap-5">
          <Link
            href="/"
            className="text-base font-semibold tracking-tight text-pavo-teal md:text-lg"
          >
            PAVO Research Agent
          </Link>
          {user && (
            <nav className="hidden items-center gap-4 md:flex">
              <Link
                href="/"
                className="text-sm text-pavo-gray-600 transition-colors hover:text-pavo-teal"
              >
                Leads
              </Link>
              <Link
                href="/pipeline"
                className="text-sm text-pavo-gray-600 transition-colors hover:text-pavo-teal"
              >
                Pipeline
              </Link>
              <Link
                href="/users"
                className="text-sm text-pavo-gray-600 transition-colors hover:text-pavo-teal"
              >
                Gebruikers
              </Link>
            </nav>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ModeBadge />
          <HeaderAuth user={user} />
        </div>
      </div>
    </header>
  );
}
