// Bedrijfsgegevens uit de companies-tabel — KvK-data zoals we 'm uit
// kvk_basisprofiel hebben opgehaald. Voor het lead-detail-blok 'Bedrijfs-
// gegevens' op /lead/[kvk].
//
// Self-heal: als de companies-row ontbreekt OF website_url null is,
// fetchen we live een vers basisprofiel uit mcp-bedrijven en upserten
// 'm. Dat dekt twee scenario's:
//   1. Companies-row is nieuw aangemaakt vóór de website-normalize-fix
//      in mcp-bedrijven 0.4.0 → website ontbreekt nu
//   2. Lead is direct opgevraagd zonder eerder via een search-run te
//      zijn upsert
// Aanvaarde extra cost: 1 basisprofiel-call (~€0.02) bij de eerste
// keer openen van een lead-detail die geen website heeft.

import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { AuthError, requireUser } from "@/lib/auth/server";
import { McpHttpClient } from "@/lib/mcp/client";
import { BedrijvenMcp, requireBedrijvenUrl } from "@/lib/mcp/bedrijven";
import { buildTenantContext } from "@/lib/mcp/tenant";

export const runtime = "nodejs";

type CompanyRow = {
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
  lat: number | null;
  lng: number | null;
  last_updated_at: string | null;
};

const SELECT_COLS =
  "kvk, naam, handelsnaam, website_url, sbi_codes, fte_klasse, plaats, provincie, bestuursvorm, oprichtingsdatum, actief, lat, lng, last_updated_at";

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
      .select(SELECT_COLS)
      .eq("kvk", kvk)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let row = data as CompanyRow | null;

    // Self-heal: row ontbreekt of website-veld is leeg → fetch fresh.
    if (!row || !row.website_url) {
      const enriched = await refreshFromMcp(kvk, supabase, row);
      if (enriched) row = enriched;
    }

    if (!row) {
      return NextResponse.json({ company: null }, { status: 404 });
    }
    return NextResponse.json({ company: row });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function refreshFromMcp(
  kvk: string,
  supabase: ReturnType<typeof tryGetSupabase>,
  existing: CompanyRow | null,
): Promise<CompanyRow | null> {
  if (!supabase) return null;
  let bedrijven: BedrijvenMcp;
  try {
    bedrijven = new BedrijvenMcp(new McpHttpClient(requireBedrijvenUrl()));
  } catch {
    // Geen MCP geconfigureerd (demo) — niets te doen.
    return existing;
  }

  let profile;
  try {
    profile = await bedrijven.kvkBasisprofiel(buildTenantContext(), kvk);
  } catch (err) {
    console.warn(`[/api/companies] basisprofiel-refresh ${kvk} faalde: ${String(err)}`);
    return existing;
  }
  if (!profile) return existing;

  const hoofd = profile.vestigingen.find((v) => v.isHoofdvestiging);
  const upsertRow = {
    kvk: profile.kvkNummer,
    naam: profile.naam,
    handelsnaam: profile.handelsnamen[0] ?? null,
    website_url: profile.websiteUrls[0] ?? null,
    sbi_codes: profile.sbiCodes,
    fte_klasse: profile.fteKlasse ?? null,
    plaats: hoofd?.adres.plaats ?? existing?.plaats ?? null,
    bestuursvorm: profile.bestuursvorm,
    oprichtingsdatum: profile.oprichtingsdatum ?? null,
    actief: profile.actief,
    last_updated_at: new Date().toISOString(),
  };
  const { error: upsertErr } = await supabase
    .from("companies")
    .upsert(upsertRow, { onConflict: "kvk" });
  if (upsertErr) {
    console.warn(`[/api/companies] upsert ${kvk} faalde: ${upsertErr.message}`);
  }

  // Re-fetch met alle kolommen zodat we provincie/lat/lng (die we niet
  // overschrijven in de upsert) ook teruggeven.
  const { data } = await supabase
    .from("companies")
    .select(SELECT_COLS)
    .eq("kvk", kvk)
    .maybeSingle();
  return (data as CompanyRow) ?? null;
}
