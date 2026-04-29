// Bedrijfsgegevens uit de companies-tabel — KvK-data zoals we 'm uit
// kvk_basisprofiel hebben opgehaald. Voor het lead-detail-blok 'Bedrijfs-
// gegevens' op /lead/[kvk]. Geen verse MCP-call: we lezen uit Supabase
// zodat het detail-paneel direct rendert.

import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { AuthError, requireUser } from "@/lib/auth/server";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ kvk: string }> },
) {
  try {
    const { kvk } = await ctx.params;
    await requireUser();
    const supabase = tryGetSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase niet geconfigureerd" }, { status: 503 });
    }

    const { data, error } = await supabase
      .from("companies")
      .select(
        "kvk, naam, handelsnaam, website_url, sbi_codes, fte_klasse, plaats, provincie, bestuursvorm, oprichtingsdatum, actief, lat, lng, last_updated_at",
      )
      .eq("kvk", kvk)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ company: null }, { status: 404 });
    }
    return NextResponse.json({ company: data });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
