"use client";

import { useEffect, useState } from "react";

type Company = {
  kvk: string;
  naam: string;
  handelsnaam: string | null;
  website_url: string | null;
  sbi_codes: string[] | null;
  fte_klasse: string | null;
  plaats: string | null;
  provincie: string | null;
  bestuursvorm: string | null;
  oprichtingsdatum: string | null;
  actief: boolean;
  last_updated_at: string | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function CompanyDataCard({ kvk }: { kvk: string }) {
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/companies/${kvk}`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setError("Niet bekend in companies-cache (nog niet gescand).");
          return;
        }
        if (!res.ok) {
          setError(`Status ${res.status}`);
          return;
        }
        const body = (await res.json()) as { company: Company };
        setCompany(body.company);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kvk]);

  if (loading) {
    return (
      <section className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-pavo-gray-600">
          Bedrijfsgegevens
        </h2>
        <p className="mt-3 text-sm text-pavo-gray-600">Laden…</p>
      </section>
    );
  }

  if (error || !company) {
    return (
      <section className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-pavo-gray-600">
          Bedrijfsgegevens
        </h2>
        <p className="mt-3 text-sm text-pavo-gray-600">{error ?? "Geen data"}</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-pavo-gray-100 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-pavo-gray-600">
        Bedrijfsgegevens
      </h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
        <Pair label="KvK-nummer" value={company.kvk} />
        <Pair label="Naam" value={company.naam} />
        {company.handelsnaam && company.handelsnaam !== company.naam && (
          <Pair label="Handelsnaam" value={company.handelsnaam} />
        )}
        <Pair label="Bestuursvorm" value={company.bestuursvorm ?? "—"} />
        <Pair
          label="Plaats"
          value={
            company.plaats
              ? `${company.plaats}${company.provincie ? `, ${company.provincie}` : ""}`
              : "—"
          }
        />
        <Pair label="FTE-klasse" value={company.fte_klasse ?? "—"} />
        <Pair label="Oprichting" value={fmtDate(company.oprichtingsdatum)} />
        <Pair
          label="Status"
          value={company.actief ? "Actief" : "Uitgeschreven"}
        />
        {company.sbi_codes && company.sbi_codes.length > 0 && (
          <div className="md:col-span-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600">
              SBI-codes
            </dt>
            <dd className="mt-0.5 flex flex-wrap gap-1.5">
              {company.sbi_codes.map((code) => (
                <span
                  key={code}
                  className="inline-block rounded border border-pavo-gray-100 bg-pavo-gray-50 px-1.5 py-0.5 font-mono text-[11px] text-pavo-gray-900"
                >
                  {code}
                </span>
              ))}
            </dd>
          </div>
        )}
        {company.website_url && (
          <div className="md:col-span-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600">
              Website
            </dt>
            <dd className="mt-0.5">
              <a
                href={company.website_url}
                target="_blank"
                rel="noreferrer"
                className="text-pavo-teal hover:underline"
              >
                {company.website_url}
              </a>
            </dd>
          </div>
        )}
      </dl>
      {company.last_updated_at && (
        <p className="mt-4 text-[11px] text-pavo-gray-600">
          Laatst bijgewerkt: {fmtDate(company.last_updated_at)}
        </p>
      )}
    </section>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600">
        {label}
      </dt>
      <dd className="mt-0.5 text-pavo-gray-900">{value}</dd>
    </div>
  );
}
