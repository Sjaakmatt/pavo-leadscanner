import { NextResponse } from "next/server";
import { getLeadSource } from "@/lib/lead-source";
import { buildLeadSteps } from "@/lib/filter";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kvk: string }> },
) {
  try {
    const { kvk } = await params;
    const lead = await getLeadSource().getLead(kvk);
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
