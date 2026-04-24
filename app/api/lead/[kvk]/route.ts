import { NextResponse } from "next/server";
import { getLeadSource } from "@/lib/lead-source";
import { buildLeadSteps } from "@/lib/filter";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ kvk: string }> },
) {
  try {
    const { kvk } = await params;
    const url = new URL(req.url);
    const refresh = url.searchParams.get("refresh") === "true";
    const lead = await getLeadSource().getLead(kvk, { refresh });
    if (!lead) {
      return NextResponse.json({ lead: null, steps: [] }, { status: 404 });
    }
    const steps = buildLeadSteps(lead);
    return NextResponse.json({ lead, steps });
  } catch (err) {
    return NextResponse.json(
      { lead: null, steps: [], error: String(err) },
      { status: 500 },
    );
  }
}
