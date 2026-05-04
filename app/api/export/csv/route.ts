import { getLeadSource } from "@/lib/lead-source";
import type { Lead, SearchFilters } from "@/lib/adapters/types";
import { parseSearchFilters, validationErrorMessage } from "@/lib/adapters/validation";
import { factum } from "@/lib/factum/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CSV-export van een complete zoekopdracht. POST met dezelfde filters
// als /api/search; de response is een UTF-8 CSV met BOM zodat Excel
// 'm goed inleest. Geen pagination — sales wil de hele lijst.
//
// Kolommen: kvk, naam, plaats, provincie, sector, fte_klasse, warmte,
// archetype, top_signaal, primaire_diensten, observatie.

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n;]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function leadToRow(lead: Lead): string {
  const primair = lead.diensten
    .filter((d) => d.prioriteit === "primair")
    .map((d) => `${d.code} ${d.naam}`)
    .join(" | ");
  const topSignaal = lead.signalen[0]?.tekst ?? "";
  return [
    lead.kvk,
    lead.naam,
    lead.plaats,
    lead.provincie,
    lead.sector,
    lead.fte_klasse,
    lead.warmte,
    lead.archetype?.naam ?? "",
    topSignaal,
    primair,
    lead.observatie,
  ]
    .map(csvEscape)
    .join(",");
}

export async function POST(req: Request) {
  let filters: SearchFilters;
  try {
    filters = parseSearchFilters(await req.json());
  } catch (err) {
    return new Response(validationErrorMessage(err), { status: 400 });
  }

  const startedAt = Date.now();
  const result = await getLeadSource().runSearch(filters);
  const header = [
    "kvk",
    "naam",
    "plaats",
    "provincie",
    "sector",
    "fte_klasse",
    "warmte",
    "archetype",
    "top_signaal",
    "primaire_diensten",
    "observatie",
  ].join(",");
  const body = [header, ...result.leads.map(leadToRow)].join("\n");

  void factum.logEvent("info", `CSV-export · ${result.leads.length} leads`, {
    branche: filters.branche,
    leads: result.leads.length,
    durationMs: Date.now() - startedAt,
  });

  // BOM ﻿ zodat Excel UTF-8 herkent.
  const csv = `﻿${body}\n`;
  const filename = `pavo-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
