// Lead-status workflow. Eén canonieke shape voor de pipeline + helpers
// om transitie-validatie centraal te houden.

export const LEAD_STATUSES = [
  "nieuw",
  "shortlist",
  "benaderd",
  "gesprek",
  "gewonnen",
  "verloren",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type LeadStatusRow = {
  kvk: string;
  owner: string;
  status: LeadStatus;
  reden: string | null;
  notitie: string | null;
  updated_at: string;
  updated_by: string | null;
};

export function isLeadStatus(s: string): s is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(s);
}

// Welke transities staan we toe? Bewust ruim — sales heeft soms een
// reden om backwards te gaan (foutje in shortlist). De UI mag dit
// optioneel verder beperken.
const FORBIDDEN: Array<[LeadStatus, LeadStatus]> = [
  ["gewonnen", "verloren"],
  ["verloren", "gewonnen"],
];

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return true;
  return !FORBIDDEN.some(([a, b]) => a === from && b === to);
}
