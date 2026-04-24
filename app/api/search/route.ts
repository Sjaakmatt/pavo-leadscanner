import { NextResponse } from "next/server";
import { getLeadSource } from "@/lib/lead-source";
import type { SearchFilters } from "@/lib/adapters/types";
import { buildSearchSteps } from "@/lib/filter";

export async function POST(req: Request) {
  try {
    const filters = (await req.json()) as SearchFilters;
    const source = getLeadSource();
    const result = await source.runSearch(filters);
    const steps = buildSearchSteps(
      filters,
      result.leads.length,
      result.relaxation,
    );
    return NextResponse.json({
      steps,
      leads: result.leads,
      relaxation: result.relaxation,
    });
  } catch (err) {
    return NextResponse.json(
      {
        steps: [],
        leads: [],
        relaxation: { regio: false, fte: false },
        error: String(err),
      },
      { status: 500 },
    );
  }
}
