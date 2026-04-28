import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import {
  canTransition,
  isLeadStatus,
  type LeadStatus,
  type LeadStatusRow,
} from "@/lib/lead-status/types";
import { factum } from "@/lib/factum/client";
import { authConfigured, getCurrentUser } from "@/lib/auth/server";

export const runtime = "nodejs";

// Owner-resolutie. Met auth aan: gebruik user.id (uuid) + e-mail als
// owner-text. Demo-mode (geen auth): valt terug op header-override of
// "default".
async function resolveOwner(req: Request): Promise<{
  owner: string;
  ownerId: string | null;
  email: string;
}> {
  if (authConfigured()) {
    const me = await getCurrentUser();
    if (me) {
      return { owner: me.email, ownerId: me.id, email: me.email };
    }
  }
  const fallback = req.headers.get("x-pavo-owner")?.trim() || "default";
  return { owner: fallback, ownerId: null, email: fallback };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ kvk: string }> },
) {
  const { kvk } = await params;
  const { owner, ownerId } = await resolveOwner(req);
  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase niet geconfigureerd" },
      { status: 503 },
    );
  }
  // Voorkeur: zoek op owner_id (auth.uid). Fallback naar owner-text
  // zodat pre-auth rijen blijven werken in dev-omgevingen.
  const query = supabase
    .from("lead_statuses")
    .select("kvk, owner, status, reden, notitie, updated_at, updated_by")
    .eq("kvk", kvk);
  const { data } = await (ownerId
    ? query.eq("owner_id", ownerId)
    : query.eq("owner", owner)
  ).maybeSingle();
  return NextResponse.json({ status: (data ?? null) as LeadStatusRow | null });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ kvk: string }> },
) {
  const { kvk } = await params;
  const { owner, ownerId, email } = await resolveOwner(req);
  const updatedBy = email;

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

  const existingQuery = supabase
    .from("lead_statuses")
    .select("status")
    .eq("kvk", kvk);
  const { data: existing } = await (ownerId
    ? existingQuery.eq("owner_id", ownerId)
    : existingQuery.eq("owner", owner)
  ).maybeSingle();
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
    owner_id: ownerId,
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
      owner_id: ownerId,
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

  // Team-notifications voor "interessante" overgangen — niet voor
  // iedere klik-tussen-twee-statussen, alleen wanneer een lead
  // converteert of voor een gesprek staat. Dropping naar in-app
  // notifications-tabel zodat collega's het bij hun bell zien.
  if (
    ownerId &&
    (next === "gesprek" || next === "gewonnen" || next === "verloren")
  ) {
    void notifyTeam(supabase, {
      kvk,
      ownerId,
      ownerEmail: email,
      next,
      from: fromStatus,
      reden: body.reden ?? null,
    });
  }

  return NextResponse.json({ status: row });
}

async function notifyTeam(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  args: {
    kvk: string;
    ownerId: string;
    ownerEmail: string;
    next: LeadStatus;
    from: LeadStatus;
    reden: string | null;
  },
): Promise<void> {
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id")
    .neq("id", args.ownerId);
  const recipients = (profiles ?? []) as Array<{ id: string }>;
  if (recipients.length === 0) return;

  const verbs: Record<LeadStatus, string> = {
    nieuw: "naar nieuw teruggezet",
    shortlist: "op shortlist gezet",
    benaderd: "benaderd",
    gesprek: "naar gesprek gezet",
    gewonnen: "gewonnen 🎉",
    verloren: "verloren",
  };

  // Lead-naam mee in de title — als companies-row bestaat.
  const { data: company } = await supabase
    .from("companies")
    .select("naam")
    .eq("kvk", args.kvk)
    .maybeSingle();
  const naam = company?.naam ?? args.kvk;

  const title = `${args.ownerEmail} heeft ${naam} ${verbs[args.next]}`;
  const body = args.reden ? `Reden: ${args.reden}` : null;

  // Note: notifications heeft een unique index op
  // (user_id, kvk, saved_search_id). Voor team-events zetten we
  // saved_search_id NULL, wat dubbele inserts toelaat — bewust, want
  // iedere status-wijziging is een nieuw event.
  const inserts = recipients.map((r) => ({
    user_id: r.id,
    saved_search_id: null,
    kvk: args.kvk,
    type: "lead_status" as const,
    title,
    body,
    metadata: {
      from: args.from,
      to: args.next,
      by: args.ownerEmail,
    },
  }));
  const { error } = await supabase.from("notifications").insert(inserts);
  if (error) {
    console.warn(`[notify-team] insert: ${error.message}`);
  }
}
