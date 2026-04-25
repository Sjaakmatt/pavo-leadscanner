import { NextResponse } from "next/server";
import { getLeadSource } from "@/lib/lead-source";
import { factum } from "@/lib/factum/client";
import { buildLeadSteps } from "@/lib/filter";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ kvk: string }> },
) {
  const startedAt = Date.now();
  const { kvk } = await params;
  try {
    const url = new URL(req.url);
    const refresh = url.searchParams.get("refresh") === "true";
    const lead = await getLeadSource().getLead(kvk, { refresh });
    if (!lead) {
      void factum.logEvent("warning", `Lead niet gevonden: ${kvk}`, { kvk });
      return NextResponse.json({ lead: null, steps: [] }, { status: 404 });
    }
    const steps = buildLeadSteps(lead);
    void factum.logEvent("info", `Lead bekeken · ${lead.naam}`, {
      kvk,
      naam: lead.naam,
      warmte: lead.warmte,
      refresh,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ lead, steps });
  } catch (err) {
    void factum.logEvent("error", `Lead-fetch faalde voor ${kvk}: ${String(err)}`, {
      kvk,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { lead: null, steps: [], error: String(err) },
      { status: 500 },
    );
  }
}
