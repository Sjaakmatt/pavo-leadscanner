import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import {
  canTransition,
  isLeadStatus,
  type LeadStatus,
  type LeadStatusRow,
} from "@/lib/lead-status/types";
import { factum } from "@/lib/factum/client";

export const runtime = "nodejs";

// Owner-resolutie. Voorlopig één globale "default" owner — bij intro
// van auth lezen we 'm uit de session. Header-override is dev-handig.
function resolveOwner(req: Request): string {
  return req.headers.get("x-pavo-owner")?.trim() || "default";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ kvk: string }> },
) {
  const { kvk } = await params;
  const owner = resolveOwner(req);
  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase niet geconfigureerd" },
      { status: 503 },
    );
  }
  const { data } = await supabase
    .from("lead_statuses")
    .select("kvk, owner, status, reden, notitie, updated_at, updated_by")
    .eq("kvk", kvk)
    .eq("owner", owner)
    .maybeSingle();
  return NextResponse.json({ status: (data ?? null) as LeadStatusRow | null });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ kvk: string }> },
) {
  const { kvk } = await params;
  const owner = resolveOwner(req);
  const updatedBy = req.headers.get("x-pavo-user") ?? owner;

  let body: { status?: string; reden?: string; notitie?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const next = body.status ?? "";
  if (!isLeadStatus(next)) {
    return NextResponse.json(
      { error: `Onbekende status: ${next}` },
      { status: 400 },
    );
  }

  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase niet geconfigureerd" },
      { status: 503 },
    );
  }

  const { data: existing } = await supabase
    .from("lead_statuses")
    .select("status")
    .eq("kvk", kvk)
    .eq("owner", owner)
    .maybeSingle();
  const fromStatus: LeadStatus = (existing?.status as LeadStatus) ?? "nieuw";
  if (!canTransition(fromStatus, next)) {
    return NextResponse.json(
      {
        error: `Transitie ${fromStatus} → ${next} niet toegestaan`,
      },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const row = {
    kvk,
    owner,
    status: next,
    reden: body.reden ?? null,
    notitie: body.notitie ?? null,
    updated_at: now,
    updated_by: updatedBy,
  };
  const { error: upsertErr } = await supabase
    .from("lead_statuses")
    .upsert([row], { onConflict: "kvk,owner" });
  if (upsertErr) {
    return NextResponse.json(
      { error: `Upsert faalde: ${upsertErr.message}` },
      { status: 500 },
    );
  }
  // Append-only audit-trail.
  await supabase.from("lead_status_history").insert([
    {
      kvk,
      owner,
      status: next,
      reden: body.reden ?? null,
      notitie: body.notitie ?? null,
      changed_at: now,
      changed_by: updatedBy,
    },
  ]);

  // ROI-event in het FactumAI-dashboard. Gewonnen/verloren zijn de
  // sterkste signalen om scoring-calibration mee te doen.
  void factum.logEvent(
    next === "gewonnen" || next === "verloren"
      ? "task_completed"
      : "info",
    `Lead-status · ${kvk} → ${next}`,
    { kvk, owner, from: fromStatus, to: next, reden: body.reden ?? null },
  );

  return NextResponse.json({ status: row });
}
