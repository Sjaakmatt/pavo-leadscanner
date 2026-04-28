// Admin-only calibration-dashboard. Beantwoordt: "klopt onze scoring?"
//
// Bron: lead_status_summary view + scored_leads. We groeperen op
// warmte, top-dienst, en archetype, en tonen leads-totaal +
// gewonnen + win-rate. Hoe meer "gewonnen" sales rapporteert, hoe
// meer signaal we hier krijgen voor toekomstige scoring-tweaks.

import Link from "next/link";
import { tryGetSupabase } from "@/lib/supabase/client";
import { authConfigured, getCurrentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

type StatusSummaryRow = {
  kvk: string;
  warmte: "HOT" | "WARM" | "COLD";
  totale_score: number;
  status: string | null;
  scored_at: string;
};

type ScoredLeadRow = {
  kvk: string;
  warmte: "HOT" | "WARM" | "COLD";
  diensten_match: Array<{
    code: string;
    naam: string;
    prioriteit: "primair" | "secundair";
    score: number;
  }>;
  samenvatting: string;
  created_at: string;
};

type Bucket = {
  label: string;
  totaal: number;
  gewonnen: number;
  verloren: number;
  in_pipeline: number;
};

function pct(num: number, denom: number): string {
  if (denom === 0) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

export default async function CalibrationPage() {
  if (!authConfigured()) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-pavo-navy">Calibration</h1>
        <p className="mt-3 text-sm text-pavo-gray-600">
          Auth niet geconfigureerd — geen calibration-data.
        </p>
      </div>
    );
  }

  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-pavo-navy">Calibration</h1>
        <p className="mt-3 text-sm text-pavo-gray-600">Alleen voor admins.</p>
      </div>
    );
  }

  const supabase = tryGetSupabase();
  if (!supabase) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-pavo-navy">Calibration</h1>
        <p className="mt-3 text-sm text-pavo-gray-600">
          Supabase niet geconfigureerd.
        </p>
      </div>
    );
  }

  // Pak status-summary (één rij per kvk met meest recente status).
  const { data: summary } = await supabase
    .from("lead_status_summary")
    .select("kvk, warmte, totale_score, status, scored_at")
    .order("scored_at", { ascending: false });
  const rows = (summary ?? []) as StatusSummaryRow[];

  // Pak scored_leads voor de dienst-grouping.
  const { data: scoredRaw } = await supabase
    .from("scored_leads")
    .select("kvk, warmte, diensten_match, samenvatting, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);
  const scored = (scoredRaw ?? []) as ScoredLeadRow[];

  // Mapping kvk → status (laatste).
  const statusByKvk = new Map<string, string | null>();
  for (const r of rows) {
    if (!statusByKvk.has(r.kvk)) statusByKvk.set(r.kvk, r.status);
  }

  function classify(status: string | null): "gewonnen" | "verloren" | "pipeline" {
    if (status === "gewonnen") return "gewonnen";
    if (status === "verloren") return "verloren";
    return "pipeline";
  }

  // Groep 1: per warmte
  const warmteBuckets: Record<string, Bucket> = {
    HOT: { label: "HOT", totaal: 0, gewonnen: 0, verloren: 0, in_pipeline: 0 },
    WARM: {
      label: "WARM",
      totaal: 0,
      gewonnen: 0,
      verloren: 0,
      in_pipeline: 0,
    },
    COLD: {
      label: "COLD",
      totaal: 0,
      gewonnen: 0,
      verloren: 0,
      in_pipeline: 0,
    },
  };
  for (const r of rows) {
    const b = warmteBuckets[r.warmte];
    if (!b) continue;
    b.totaal += 1;
    const k = classify(r.status);
    if (k === "gewonnen") b.gewonnen += 1;
    else if (k === "verloren") b.verloren += 1;
    else b.in_pipeline += 1;
  }

  // Groep 2: per primaire dienst
  const dienstBuckets = new Map<string, Bucket>();
  for (const sl of scored) {
    const top = (sl.diensten_match ?? []).find(
      (d) => d.prioriteit === "primair",
    );
    if (!top) continue;
    const key = `${top.code} — ${top.naam}`;
    let b = dienstBuckets.get(key);
    if (!b) {
      b = { label: key, totaal: 0, gewonnen: 0, verloren: 0, in_pipeline: 0 };
      dienstBuckets.set(key, b);
    }
    b.totaal += 1;
    const status = statusByKvk.get(sl.kvk) ?? null;
    const cls = classify(status);
    if (cls === "gewonnen") b.gewonnen += 1;
    else if (cls === "verloren") b.verloren += 1;
    else b.in_pipeline += 1;
  }
  const dienstRows = [...dienstBuckets.values()].sort(
    (a, b) => b.totaal - a.totaal,
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-pavo-navy md:text-3xl">
        Scoring-calibration
      </h1>
      <p className="mt-2 text-sm text-pavo-gray-600">
        Werkt onze warmte- en dienstmatch-engine? Hieronder zie je per
        bucket hoeveel leads er zijn aangeleverd en wat de uiteindelijke
        win-rate is. Hoe meer status-data sales rapporteert, hoe
        scherper deze cijfers worden.
      </p>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
        Win-rate per warmte
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        {(["HOT", "WARM", "COLD"] as const).map((w) => {
          const b = warmteBuckets[w];
          const conv = b.totaal === 0 ? "—" : pct(b.gewonnen, b.totaal);
          return (
            <div
              key={w}
              className="rounded-lg border border-pavo-gray-100 bg-white p-4 shadow-sm"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-pavo-gray-600">
                {w}
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-pavo-navy">
                {conv}
              </p>
              <p className="mt-1 text-xs text-pavo-gray-600">
                {b.gewonnen} gewonnen · {b.verloren} verloren ·{" "}
                {b.in_pipeline} in pipeline ({b.totaal} totaal)
              </p>
            </div>
          );
        })}
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wide text-pavo-gray-600">
        Win-rate per primaire dienst
      </h2>
      {dienstRows.length === 0 ? (
        <p className="mt-3 text-sm text-pavo-gray-600">
          Nog geen scored_leads met dienst-match.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-pavo-gray-100 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="border-b border-pavo-gray-100 bg-pavo-gray-50/40 text-pavo-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Dienst</th>
                <th className="px-3 py-2 text-right font-medium">Totaal</th>
                <th className="px-3 py-2 text-right font-medium">Gewonnen</th>
                <th className="px-3 py-2 text-right font-medium">Verloren</th>
                <th className="px-3 py-2 text-right font-medium">Pipeline</th>
                <th className="px-3 py-2 text-right font-medium">Win-rate</th>
              </tr>
            </thead>
            <tbody>
              {dienstRows.map((b) => {
                const beslist = b.gewonnen + b.verloren;
                const winrate =
                  beslist === 0 ? "—" : pct(b.gewonnen, beslist);
                return (
                  <tr
                    key={b.label}
                    className="border-b border-pavo-gray-100/70 last:border-0"
                  >
                    <td className="px-3 py-2 text-pavo-gray-900">
                      {b.label}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {b.totaal}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                      {b.gewonnen}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-pavo-orange">
                      {b.verloren}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-pavo-gray-600">
                      {b.in_pipeline}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-pavo-navy">
                      {winrate}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-pavo-gray-600">
        Nog geen scoring-update afgeleid — dit dashboard is observability.
        Wanneer er voldoende beslissingen zijn (≥30 per bucket) kunnen we
        de cluster-weights data-driven tunen via een Bayesiaanse update.
      </p>
      <p className="mt-3 text-xs">
        <Link href="/admin/searches" className="text-pavo-teal hover:underline">
          ← Search-observability
        </Link>
      </p>
    </div>
  );
}
