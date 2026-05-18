import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import {
  canTransition,
  isLeadStatus,
  type LeadStatus,
  type LeadStatusRow,
} from "@/lib/lead-status/types";
import { factum } from "@/lib/factum/client";
import { resolveOwnerScope } from "@/lib/auth/server";
import { email as emailLib } from "@/lib/email/client";
import { leadStatusEmail } from "@/lib/email/templates";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ kvk: string }> },
) {
  const { kvk } = await params;
  const scope = await resolveOwnerScope(req);
  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase niet geconfigureerd" },
      { status: 503 },
    );
  }

  // Met auth aan scopen we op org_id + owner_id; in demo-mode op
  // owner-text. De API geeft alleen rijen binnen de eigen scope.
  let query = supabase
    .from("lead_statuses")
    .select("kvk, owner, status, reden, notitie, updated_at, updated_by")
    .eq("kvk", kvk);
  if (scope.orgId) query = query.eq("org_id", scope.orgId);
  query = scope.ownerId
    ? query.eq("owner_id", scope.ownerId)
    : query.eq("owner", scope.ownerLabel);
  const { data } = await query.maybeSingle();
  return NextResponse.json({ status: (data ?? null) as LeadStatusRow | null });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ kvk: string }> },
) {
  const { kvk } = await params;
  const scope = await resolveOwnerScope(req);
  const updatedBy = scope.email;

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

  let existingQuery = supabase
    .from("lead_statuses")
    .select("status")
    .eq("kvk", kvk);
  if (scope.orgId) existingQuery = existingQuery.eq("org_id", scope.orgId);
  existingQuery = scope.ownerId
    ? existingQuery.eq("owner_id", scope.ownerId)
    : existingQuery.eq("owner", scope.ownerLabel);
  const { data: existing } = await existingQuery.maybeSingle();
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
    owner: scope.ownerLabel,
    owner_id: scope.ownerId,
    org_id: scope.orgId,
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
      owner: scope.ownerLabel,
      owner_id: scope.ownerId,
      org_id: scope.orgId,
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
    {
      kvk,
      owner: scope.ownerLabel,
      org_id: scope.orgId,
      from: fromStatus,
      to: next,
      reden: body.reden ?? null,
    },
  );

  // Team-notifications voor "interessante" overgangen.
  if (
    scope.ownerId &&
    scope.orgId &&
    (next === "gesprek" || next === "gewonnen" || next === "verloren")
  ) {
    void notifyTeam(supabase, {
      kvk,
      ownerId: scope.ownerId,
      ownerEmail: scope.email,
      orgId: scope.orgId,
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
    orgId: string;
    next: LeadStatus;
    from: LeadStatus;
    reden: string | null;
  },
): Promise<void> {
  // Alleen collega's binnen dezelfde org.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, notif_email_team")
    .eq("org_id", args.orgId)
    .neq("id", args.ownerId);
  const recipients = (profiles ?? []) as Array<{
    id: string;
    email: string;
    notif_email_team: boolean | null;
  }>;
  if (recipients.length === 0) return;

  const verbs: Record<LeadStatus, string> = {
    nieuw: "naar nieuw teruggezet",
    shortlist: "op shortlist gezet",
    benaderd: "benaderd",
    gesprek: "naar gesprek gezet",
    gewonnen: "gewonnen 🎉",
    verloren: "verloren",
  };

  const { data: company } = await supabase
    .from("companies")
    .select("naam")
    .eq("kvk", args.kvk)
    .maybeSingle();
  const naam = company?.naam ?? args.kvk;

  const title = `${args.ownerEmail} heeft ${naam} ${verbs[args.next]}`;
  const body = args.reden ? `Reden: ${args.reden}` : null;

  const inserts = recipients.map((r) => ({
    user_id: r.id,
    org_id: args.orgId,
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

  // E-mail flow — alleen voor users die opt-in hebben.
  if (emailLib.enabled) {
    const base =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    const url = base ? `${base}/lead/${args.kvk}` : `/lead/${args.kvk}`;
    for (const r of recipients) {
      if (!r.notif_email_team || !r.email) continue;
      const tpl = leadStatusEmail({
        changedBy: args.ownerEmail,
        leadNaam: naam,
        toStatus: args.next,
        reden: args.reden,
        dashboardUrl: url,
      });
      void emailLib
        .send({
          to: r.email,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
        })
        .then((res) => {
          if (!res.ok) {
            console.warn(
              `[notify-team] email naar ${r.email} faalde: ${res.error}`,
            );
          }
        });
    }
  }
}
