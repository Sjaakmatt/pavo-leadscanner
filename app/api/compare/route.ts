import { NextResponse } from "next/server";
import { getLeadSource } from "@/lib/lead-source";
import type { Lead } from "@/lib/adapters/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Haalt 2-5 leads op (per kvk) zodat de /compare pagina ze
// side-by-side kan tonen. Gebruikt getLeadSource — dus werkt voor
// zowel demo als prod. Geen scrape; lees uit cache.
//
// Body: { kvks: string[] }

export async function POST(req: Request) {
  let body: { kvks?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const kvks = (body.kvks ?? [])
    .map((k) => String(k).trim())
    .filter(Boolean)
    .slice(0, 5);
  if (kvks.length < 2) {
    return NextResponse.json(
      { error: "Minimaal 2 kvk-nummers vereist" },
      { status: 400 },
    );
  }

  const source = getLeadSource();
  const leads: Lead[] = [];
  for (const kvk of kvks) {
    const lead = await source.getLead(kvk);
    if (lead) leads.push(lead);
  }
  return NextResponse.json({ leads });
}
