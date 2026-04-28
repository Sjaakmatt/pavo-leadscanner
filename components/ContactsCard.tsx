"use client";

import { useEffect, useState } from "react";

type Contact = {
  id: string;
  naam: string;
  functie: string | null;
  email: string | null;
  telefoon: string | null;
  bron: "kvk" | "website" | "handmatig";
  bron_url: string | null;
  bewijs: string | null;
};

const BRON_LABEL: Record<Contact["bron"], string> = {
  kvk: "KvK-bestuurder",
  website: "Website",
  handmatig: "Handmatig",
};

const BRON_COLOR: Record<Contact["bron"], string> = {
  kvk: "bg-pavo-teal/10 text-pavo-teal",
  website: "bg-pavo-orange/10 text-pavo-orange",
  handmatig: "bg-pavo-gray-100 text-pavo-gray-600",
};

export default function ContactsCard({ kvk }: { kvk: string }) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/lead/${kvk}/contacts`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { contacts: Contact[] };
        if (!cancelled) setContacts(body.contacts);
      } catch {
        // silent
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kvk]);

  if (contacts === null) {
    return (
      <section className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm md:p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
          Contacten
        </h2>
        <div className="mt-3 h-12 animate-pulse rounded bg-pavo-gray-100" />
      </section>
    );
  }

  if (contacts.length === 0) {
    return (
      <section className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm md:p-6">
        <div className="flex items-center gap-2">
          <UsersIcon className="h-4 w-4 text-pavo-teal" />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
            Contacten
          </h2>
        </div>
        <p className="mt-3 text-sm text-pavo-gray-600">
          Nog geen contacten gevonden — probeer de lead te refreshen of
          voeg er handmatig toe na het eerste gesprek.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UsersIcon className="h-4 w-4 text-pavo-teal" />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
            Contacten
          </h2>
        </div>
        <span className="text-xs text-pavo-gray-600">
          {contacts.length}{" "}
          {contacts.length === 1 ? "persoon" : "personen"}
        </span>
      </div>

      <ul className="mt-4 divide-y divide-pavo-gray-100">
        {contacts.map((c) => (
          <li key={c.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-pavo-gray-900">
                  {c.naam}
                </p>
                {c.functie && (
                  <p className="text-xs text-pavo-gray-600">{c.functie}</p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
                  {c.email && (
                    <a
                      href={`mailto:${c.email}`}
                      className="text-pavo-teal hover:underline"
                    >
                      {c.email}
                    </a>
                  )}
                  {c.telefoon && (
                    <a
                      href={`tel:${c.telefoon.replace(/\s/g, "")}`}
                      className="text-pavo-teal hover:underline"
                    >
                      {c.telefoon}
                    </a>
                  )}
                </div>
                {c.bewijs && (
                  <p className="mt-1.5 text-[11px] italic text-pavo-gray-600">
                    &ldquo;{c.bewijs}&rdquo;
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${BRON_COLOR[c.bron]}`}
                title={
                  c.bron_url
                    ? `Gevonden op ${c.bron_url}`
                    : `Bron: ${BRON_LABEL[c.bron]}`
                }
              >
                {BRON_LABEL[c.bron]}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-pavo-gray-600">
        KvK-bestuurders zijn feitelijk; website-contacten kunnen verouderd zijn.
      </p>
    </section>
  );
}

function UsersIcon({ className = "" }: { className?: string }) {
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
      <circle cx="7" cy="7" r="3" />
      <path d="M2 17c0-2.5 2-5 5-5s5 2.5 5 5" />
      <circle cx="14" cy="6" r="2.5" />
      <path d="M18 15c0-2-1.5-4-4-4" />
    </svg>
  );
}
