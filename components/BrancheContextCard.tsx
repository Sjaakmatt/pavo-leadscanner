"use client";

// Branche-context-card op de lead-detail-pagina. Trekt CBS-cijfers
// voor SBI-sector + provincie van de lead, geeft sales een gespreks-
// opener: hoe staat deze branche/regio er gemiddeld voor?
//
// Loading is asynchroon (CBS-API kan ~500ms-2s zijn voor cold cache).
// Wanneer dataset leeg is laten we alsnog wat we WEL hebben zien — geen
// alles-of-niets fallback.

import { useEffect, useState } from "react";

type CbsContext = {
  branche: { code: string; naam: string };
  regio: { code: string; naam: string };
  verzuim: {
    branche: string;
    periode: string;
    percentage: number | null;
    landelijkPercentage: number | null;
  } | null;
  krapte: {
    regio: string;
    periode: string;
    indicator: number | null;
    classificatie: "ruim" | "gemiddeld" | "krap" | "zeer_krap" | "onbekend";
  } | null;
  vacaturegraad: {
    branche: string;
    periode: string;
    vacaturegraad: number | null;
    landelijk: number | null;
  } | null;
  faillissementen: {
    branche: string;
    laatsteMaand: { periode: string; aantal: number | null } | null;
    twaalfMaandsTotaal: number | null;
    yoyVerschil: number | null;
  } | null;
  caoLoon: {
    branche: string;
    periode: string;
    yoyPercentage: number | null;
  } | null;
};

type Props = { kvk: string };

export default function BrancheContextCard({ kvk }: Props) {
  const [data, setData] = useState<CbsContext | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/cbs/branche?kvk=${encodeURIComponent(kvk)}`);
      if (!res.ok) {
        if (!cancelled) setLoading(false);
        return;
      }
      const json = (await res.json()) as CbsContext;
      if (!cancelled) {
        setData(json);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [kvk]);

  if (loading) {
    return (
      <div className="rounded-lg border border-pavo-gray-100 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
          Branche- & regio-context (CBS)
        </p>
        <div className="mt-3 h-16 animate-pulse rounded bg-pavo-gray-100" />
      </div>
    );
  }
  if (!data) return null;

  const heeftIetsZinnigs =
    data.verzuim || data.krapte || data.vacaturegraad || data.faillissementen || data.caoLoon;
  if (!heeftIetsZinnigs) return null;

  return (
    <div className="rounded-lg border border-pavo-gray-100 bg-white p-4 shadow-sm md:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
          Branche- & regio-context
        </p>
        <p className="text-[10px] text-pavo-gray-600">
          Bron: CBS Open Data · {data.branche.naam} · {data.regio.naam}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {data.verzuim && (
          <Tile
            label="Ziekteverzuim"
            value={fmtPct(data.verzuim.percentage)}
            sub={
              data.verzuim.landelijkPercentage !== null
                ? `landelijk ${fmtPct(data.verzuim.landelijkPercentage)}`
                : undefined
            }
            periode={data.verzuim.periode}
          />
        )}
        {data.krapte && (
          <Tile
            label="Arbeidsmarkt"
            value={krapteLabel(data.krapte.classificatie)}
            sub={
              data.krapte.indicator !== null
                ? `index ${data.krapte.indicator.toFixed(0)}`
                : undefined
            }
            periode={data.krapte.periode}
          />
        )}
        {data.vacaturegraad && (
          <Tile
            label="Vacaturegraad"
            value={
              data.vacaturegraad.vacaturegraad !== null
                ? `${data.vacaturegraad.vacaturegraad.toFixed(1)} per 100 banen`
                : "—"
            }
            sub={
              data.vacaturegraad.landelijk !== null
                ? `landelijk ${data.vacaturegraad.landelijk.toFixed(1)}`
                : undefined
            }
            periode={data.vacaturegraad.periode}
          />
        )}
        {data.faillissementen && (
          <Tile
            label="Faillissementen sector (12mnd)"
            value={
              data.faillissementen.twaalfMaandsTotaal !== null
                ? data.faillissementen.twaalfMaandsTotaal.toString()
                : "—"
            }
            sub={
              data.faillissementen.yoyVerschil !== null
                ? `${data.faillissementen.yoyVerschil > 0 ? "+" : ""}${data.faillissementen.yoyVerschil.toFixed(0)}% YoY`
                : undefined
            }
            periode={data.faillissementen.laatsteMaand?.periode}
          />
        )}
        {data.caoLoon && (
          <Tile
            label="Cao-loonontwikkeling"
            value={
              data.caoLoon.yoyPercentage !== null
                ? `${data.caoLoon.yoyPercentage > 0 ? "+" : ""}${data.caoLoon.yoyPercentage.toFixed(1)}% YoY`
                : "—"
            }
            periode={data.caoLoon.periode}
          />
        )}
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  periode,
}: {
  label: string;
  value: string;
  sub?: string;
  periode?: string;
}) {
  return (
    <div className="rounded-md bg-pavo-gray-50/40 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-pavo-navy">
        {value}
      </p>
      {sub && <p className="text-[11px] text-pavo-gray-600">{sub}</p>}
      {periode && (
        <p className="mt-0.5 text-[10px] text-pavo-gray-600/70">
          {fmtPeriode(periode)}
        </p>
      )}
    </div>
  );
}

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(1)}%`;
}

function krapteLabel(c: string): string {
  switch (c) {
    case "zeer_krap":
      return "Zeer krap";
    case "krap":
      return "Krap";
    case "gemiddeld":
      return "Gemiddeld";
    case "ruim":
      return "Ruim";
    default:
      return "Onbekend";
  }
}

// CBS-perioden: "2024KW04" → "Q4 2024", "2024MM03" → "mrt 2024", "2024JJ00" → "2024"
function fmtPeriode(p: string): string {
  const yr = p.slice(0, 4);
  const tag = p.slice(4, 6);
  const num = p.slice(6);
  if (tag === "KW") return `Q${num} ${yr}`;
  if (tag === "MM") {
    const month = Number.parseInt(num, 10);
    const months = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
    return `${months[month - 1] ?? num} ${yr}`;
  }
  return yr;
}
