import { NextResponse } from "next/server";
import { getLeadSource } from "@/lib/lead-source";
import { logObs, logError } from "@/lib/observability/logger";
import { authConfigured, getCurrentUser } from "@/lib/auth/server";
import { buildLeadSteps } from "@/lib/filter";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ kvk: string }> },
) {
  const startedAt = Date.now();
  const { kvk } = await params;
  let orgId: string | null = null;
  let userId: string | null = null;
  if (authConfigured()) {
    const me = await getCurrentUser();
    orgId = me?.orgId ?? null;
    userId = me?.id ?? null;
  }
  try {
    const url = new URL(req.url);
    const refresh = url.searchParams.get("refresh") === "true";
    const lead = await getLeadSource().getLead(kvk, { refresh });
    if (!lead) {
      void logObs({
        type: "warning",
        category: "user_action",
        message: `Lead niet gevonden · kvk=${kvk}`,
        orgId,
        userId,
        metadata: { kvk },
      });
      return NextResponse.json({ lead: null, steps: [] }, { status: 404 });
    }
    const steps = buildLeadSteps(lead);
    void logObs({
      type: "info",
      category: "user_action",
      message: `Lead bekeken · kvk=${kvk} warmte=${lead.warmte}`,
      orgId,
      userId,
      metadata: {
        kvk,
        warmte: lead.warmte,
        refresh,
        durationMs: Date.now() - startedAt,
      },
    });
    return NextResponse.json({ lead, steps });
  } catch (err) {
    void logError("user_action", `Lead-fetch faalde · kvk=${kvk}`, err, {
      orgId,
      userId,
      metadata: { kvk, durationMs: Date.now() - startedAt },
    });
    return NextResponse.json(
      { lead: null, steps: [], error: String(err) },
      { status: 500 },
    );
  }
}
