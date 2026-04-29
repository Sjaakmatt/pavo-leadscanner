// Detail van één afgelopen search-run + de bijbehorende leads. Reconstrueert
// Lead-objecten uit Supabase zonder verse MCP-calls te doen — geschiedenis
// is altijd "wat we destijds opleverden", niet "wat zou er nu uit komen".
//
// Signalen komen wel uit de huidige `signals`-tabel (niet bevroren) zodat
// we niet per-search-snapshot signaal-state hoeven te dupliceren. Voor de
// meeste leads is dat hetzelfde; bij een paar updates ziet de gebruiker
// de meest recente bevindingen — acceptabel voor een history-view.

import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { AuthError, requireUser } from "@/lib/auth/server";
import type {
  Bron,
  DienstCode,
  DienstMatch,
  FteKlasse,
  Lead,
  Signaal,
  Warmte,
} from "@/lib/adapters/types";

export const runtime = "nodejs";

type CompanyRow = {
  kvk: string;
  naam: string;
  plaats: string | null;
  provincie: string | null;
  sbi_codes: string[] | null;
  fte_klasse: string | null;
  lat: number | null;
  lng: number | null;
};

type ScoredLeadRow = {
  kvk: string;
  warmte: Warmte;
  totale_score: number;
  diensten_match: unknown;
  samenvatting: string | null;
};

type SignalRow = {
  kvk: string;
  observatie: string;
  bron_type: string | null;
  bron_url: string | null;
  bewijs: string[] | null;
};

const BRON_TYPE_TO_BRON: Record<string, Bron> = {
  website: "bedrijfswebsite",
  rechtspraak: "Rechtspraak.nl",
  nla: "NLA",
  insolventie: "Insolventieregister",
  news: "Nieuws",
  vacatures: "Vacatures",
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const me = await requireUser();
    const supabase = tryGetSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase niet geconfigureerd" }, { status: 503 });
    }

    // 1) Search row + org-scope check.
    const { data: search } = await supabase
      .from("search_queries")
      .select(
        "id, filters, status, total_candidates, total_leads_returned, duration_ms, total_cost_usd, created_at, completed_at, org_id",
      )
      .eq("id", id)
      .single();
    if (!search) {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }
    if (search.org_id && search.org_id !== me.orgId) {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    // 2) scored_leads voor deze run.
    const { data: scoredRaw } = await supabase
      .from("scored_leads")
      .select("kvk, warmte, totale_score, diensten_match, samenvatting")
      .eq("search_query_id", id)
      .order("totale_score", { ascending: false });
    const scored = (scoredRaw ?? []) as ScoredLeadRow[];

    if (scored.length === 0) {
      return NextResponse.json({ search, leads: [] });
    }

    const kvks = scored.map((s) => s.kvk);

    // 3) Companies-info voor die kvk's.
    const { data: companiesRaw } = await supabase
      .from("companies")
      .select("kvk, naam, plaats, provincie, sbi_codes, fte_klasse, lat, lng")
      .in("kvk", kvks);
    const companies = new Map(
      ((companiesRaw ?? []) as CompanyRow[]).map((c) => [c.kvk, c]),
    );

    // 4) Recente signalen per kvk (best-effort dedup op categorie+bron).
    const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const { data: signalsRaw } = await supabase
      .from("signals")
      .select("kvk, observatie, bron_type, bron_url, bewijs, detected_at")
      .in("kvk", kvks)
      .gte("detected_at", cutoff)
      .order("detected_at", { ascending: false });
    const signalsByKvk = new Map<string, Signaal[]>();
    for (const row of (signalsRaw ?? []) as SignalRow[]) {
      const list = signalsByKvk.get(row.kvk) ?? [];
      const bron = BRON_TYPE_TO_BRON[row.bron_type ?? ""] ?? "Nieuws";
      list.push({
        tekst: row.observatie,
        bron,
        bewijs: row.bewijs ?? undefined,
        bronUrl: row.bron_url ?? undefined,
      });
      signalsByKvk.set(row.kvk, list);
    }

    // 5) Reconstrueer Lead per row.
    const leads: Lead[] = scored.map((s) => {
      const c = companies.get(s.kvk);
      const dienstenJson = (s.diensten_match ?? []) as Array<{
        code?: string;
        naam?: string;
        prioriteit?: "primair" | "secundair";
        score?: number;
      }>;
      const diensten: DienstMatch[] = dienstenJson
        .filter((d): d is Required<typeof d> => !!d.code && !!d.naam && !!d.prioriteit && d.score !== undefined)
        .map((d) => ({
          code: d.code as DienstCode,
          naam: d.naam,
          prioriteit: d.prioriteit,
          score: d.score,
        }));
      return {
        id: s.kvk,
        naam: c?.naam ?? s.kvk,
        kvk: s.kvk,
        plaats: c?.plaats ?? "",
        provincie: c?.provincie ?? "",
        sector: c?.sbi_codes?.[0] ?? "",
        fte_klasse: ((c?.fte_klasse ?? "10-19") as FteKlasse),
        warmte: s.warmte,
        archetype: null,
        signalen: signalsByKvk.get(s.kvk) ?? [],
        diensten,
        observatie: s.samenvatting ?? "",
        lat: c?.lat ?? undefined,
        lng: c?.lng ?? undefined,
      };
    });

    return NextResponse.json({ search, leads });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
