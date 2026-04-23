import { NextResponse } from "next/server";
import { mockLeadSource } from "@/lib/adapters/mock";
import type { SearchFilters } from "@/lib/adapters/types";
import { buildSearchSteps } from "@/lib/filter";

export async function POST(req: Request) {
  try {
    const filters = (await req.json()) as SearchFilters;
    const result = await mockLeadSource.runSearch(filters);
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
