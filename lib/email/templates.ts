// Minimale e-mail-templates. Plain HTML met inline-styles zodat ze
// in de meeste mailclients goed renderen — geen externe CSS, geen
// images. Houdt 'em transactioneel en kort.
//
// Brand-kleuren komen uit de UI (pavo-teal #1B5F6C, pavo-orange #E87544,
// navy #0F3E47).

const TEAL = "#1B5F6C";
const NAVY = "#0F3E47";
const ORANGE = "#E87544";
const GRAY = "#6C757D";

function shell(content: string, ctaUrl?: string, ctaLabel?: string): string {
  const cta = ctaUrl
    ? `<p style="margin:24px 0 0;">
         <a href="${ctaUrl}"
            style="display:inline-block;padding:10px 18px;background:${TEAL};
                   color:#fff;text-decoration:none;border-radius:6px;
                   font-weight:600;font-size:14px;">
           ${ctaLabel ?? "Open in PAVO"}
         </a>
       </p>`
    : "";
  return `<!doctype html>
<html lang="nl"><body style="margin:0;padding:24px;background:#F8F9FA;font-family:system-ui,Inter,sans-serif;color:${NAVY};">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E9ECEF;border-radius:8px;padding:24px;">
    <p style="margin:0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${GRAY};">
      PAVO Research Agent
    </p>
    <div style="margin-top:8px;font-size:14px;line-height:1.5;">
      ${content}
    </div>
    ${cta}
    <hr style="border:0;border-top:1px solid #E9ECEF;margin:24px 0 12px;" />
    <p style="margin:0;font-size:11px;color:${GRAY};">
      Je krijgt deze mail omdat je dit type meldingen hebt aanstaan.
      Beheer je voorkeuren via <em>/users</em> &gt; mijn instellingen.
    </p>
  </div>
</body></html>`;
}

export type SavedSearchEmailArgs = {
  searchNaam: string;
  leadNaam: string;
  observatie: string;
  archetype: string | null;
  plaats: string;
  fteKlasse: string;
  dashboardUrl: string;
};

export function savedSearchEmail(args: SavedSearchEmailArgs): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `${args.leadNaam} matcht je zoekopdracht "${args.searchNaam}"`;
  const html = shell(
    `<p style="margin:0 0 12px;">
       <strong>${args.leadNaam}</strong> matcht je opgeslagen zoekopdracht
       <em>${args.searchNaam}</em>.
     </p>
     <ul style="margin:0;padding-left:18px;color:${NAVY};">
       <li>Plaats: ${args.plaats || "—"}</li>
       <li>FTE-klasse: ${args.fteKlasse}</li>
       ${args.archetype ? `<li>Archetype: ${args.archetype}</li>` : ""}
     </ul>
     ${
       args.observatie
         ? `<p style="margin:12px 0 0;color:${GRAY};font-style:italic;">"${escapeHtml(
             args.observatie,
           )}"</p>`
         : ""
     }`,
    args.dashboardUrl,
    "Bekijk lead",
  );
  const text = `${args.leadNaam} matcht je opgeslagen zoekopdracht "${args.searchNaam}".

Plaats: ${args.plaats || "—"}
FTE: ${args.fteKlasse}
${args.archetype ? `Archetype: ${args.archetype}\n` : ""}
${args.observatie ? `\n"${args.observatie}"\n` : ""}
Open in PAVO: ${args.dashboardUrl}`;
  return { subject, html, text };
}

export type LeadStatusEmailArgs = {
  changedBy: string;
  leadNaam: string;
  toStatus: string;
  reden: string | null;
  dashboardUrl: string;
};

export function leadStatusEmail(args: LeadStatusEmailArgs): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `${args.leadNaam} → ${args.toStatus} door ${args.changedBy}`;
  const isWin = args.toStatus === "gewonnen";
  const isLoss = args.toStatus === "verloren";
  const accent = isWin
    ? `<span style="color:#047857;font-weight:600;">gewonnen 🎉</span>`
    : isLoss
      ? `<span style="color:${ORANGE};font-weight:600;">verloren</span>`
      : `<strong>${escapeHtml(args.toStatus)}</strong>`;
  const html = shell(
    `<p style="margin:0;">
       <strong>${escapeHtml(args.changedBy)}</strong> heeft
       <strong>${escapeHtml(args.leadNaam)}</strong> ${accent}.
     </p>
     ${
       args.reden
         ? `<p style="margin:12px 0 0;color:${GRAY};">Reden: ${escapeHtml(
             args.reden,
           )}</p>`
         : ""
     }`,
    args.dashboardUrl,
    "Bekijk lead",
  );
  const text = `${args.changedBy} heeft ${args.leadNaam} naar ${args.toStatus} gezet.
${args.reden ? `Reden: ${args.reden}\n` : ""}
Open in PAVO: ${args.dashboardUrl}`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
