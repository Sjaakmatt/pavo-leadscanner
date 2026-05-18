import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";

export const runtime = "nodejs";

// Trend-detection v1 — leest signals.detected_at + sterkte voor een
// kvk uit de afgelopen 90 dagen en bouwt buckets per categorie.
// Geeft per categorie de sterkte-trend (huidig vs 60d eerder) terug.
//
// Geeft alleen output voor signaal-categorieën die we als
// trend-relevant beschouwen — vacatures + reviews + verzuim. Andere
// categorieën zijn binair (faillissement, NLA-boete) en hebben geen
// trend-betekenis.

const TREND_WINDOW_DAYS = 90;
const RECENT_DAYS = 30;
const TREND_CATEGORIES = [
  "veel_open_vacatures",
  "langlopende_vacatures",
  "herposte_vacatures",
  "negatieve_reviews_chaos",
  "verzuim_burnout_signalen",
  "snelle_groei",
] as const;

type Bucket = {
  categorie: string;
  recent_count: number;
  recent_avg_sterkte: number;
  baseline_count: number;
  baseline_avg_sterkte: number;
  delta_pct: number;
  signaal_history: Array<{ detected_at: string; sterkte: number }>;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kvk: string }> },
) {
  const { kvk } = await params;
  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json({ trends: [] });
  }
  const cutoff = new Date(
    Date.now() - TREND_WINDOW_DAYS * 86_400_000,
  ).toISOString();

  const { data, error } = await supabase
    .from("signals")
    .select("categorie, sterkte, detected_at")
    .eq("kvk", kvk)
    .in("categorie", TREND_CATEGORIES as unknown as string[])
    .gte("detected_at", cutoff)
    .order("detected_at", { ascending: true });

  if (error) {
    return NextResponse.json({ trends: [], error: error.message });
  }

  const recentCutoff = Date.now() - RECENT_DAYS * 86_400_000;
  const buckets = new Map<string, Bucket>();

  for (const row of (data ?? []) as Array<{
    categorie: string;
    sterkte: number;
    detected_at: string;
  }>) {
    const t = new Date(row.detected_at).getTime();
    const isRecent = t >= recentCutoff;

    let b = buckets.get(row.categorie);
    if (!b) {
      b = {
        categorie: row.categorie,
        recent_count: 0,
        recent_avg_sterkte: 0,
        baseline_count: 0,
        baseline_avg_sterkte: 0,
        delta_pct: 0,
        signaal_history: [],
      };
      buckets.set(row.categorie, b);
    }
    b.signaal_history.push({
      detected_at: row.detected_at,
      sterkte: row.sterkte,
    });
    if (isRecent) {
      b.recent_count += 1;
      b.recent_avg_sterkte += row.sterkte;
    } else {
      b.baseline_count += 1;
      b.baseline_avg_sterkte += row.sterkte;
    }
  }

  const trends: Bucket[] = [];
  for (const b of buckets.values()) {
    if (b.recent_count > 0) b.recent_avg_sterkte /= b.recent_count;
    if (b.baseline_count > 0) b.baseline_avg_sterkte /= b.baseline_count;
    if (b.baseline_avg_sterkte > 0) {
      b.delta_pct = Math.round(
        ((b.recent_avg_sterkte - b.baseline_avg_sterkte) /
          b.baseline_avg_sterkte) *
          100,
      );
    } else if (b.recent_avg_sterkte > 0) {
      b.delta_pct = 100; // baseline = 0, recent > 0 → nieuw
    }
    // Alleen tonen als er iets te zeggen is.
    if (b.recent_count + b.baseline_count > 0) {
      trends.push(b);
    }
  }

  return NextResponse.json({ trends });
}
