// CBS branche-context endpoint. Geeft een gecombineerde snapshot van
// 5 datasets voor een lead op basis van SBI-code + provincie.
//
// Inputs via query-params:
//   ?kvk=12345678            — KvK-nummer; route looks up SBI + provincie
//                              uit companies-tabel
//   ?sbi=43211               — direct SBI-code (override)
//   ?provincie=Noord-Holland — direct provincie (override)
//
// Bij ontbreken vallen we terug op landelijke cijfers (alle bedrijfstakken
// / Nederland-totaal).

import { NextResponse } from "next/server";
import { fetchBrancheContext } from "@/lib/cbs/queries";
import { tryGetSupabase } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kvk = url.searchParams.get("kvk");
  let sbi = url.searchParams.get("sbi");
  let provincie = url.searchParams.get("provincie");

  // Resolve SBI + provincie uit companies-tabel als alleen KvK gegeven is.
  if (kvk && (!sbi || !provincie)) {
    const supabase = tryGetSupabase();
    if (supabase) {
      const { data } = await supabase
        .from("companies")
        .select("sbi_codes, provincie")
        .eq("kvk", kvk)
        .maybeSingle();
      if (data) {
        const row = data as { sbi_codes?: string[] | null; provincie?: string | null };
        if (!sbi && Array.isArray(row.sbi_codes) && row.sbi_codes[0]) {
          sbi = row.sbi_codes[0];
        }
        if (!provincie && row.provincie) {
          provincie = row.provincie;
        }
      }
    }
  }

  const context = await fetchBrancheContext({
    sbiCode: sbi,
    provincie,
  });
  return NextResponse.json(context);
}
