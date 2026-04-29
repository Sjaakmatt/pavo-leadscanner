import type { SearchFilters } from "./adapters/types";

export const BRANCHE_OPTIONS = [
  "Alle branches",
  "Bouw & installatie",
  "Logistiek & transport",
  "Zakelijke dienstverlening",
  "Productie & techniek",
  "Retail & e-commerce",
] as const;

export const FTE_OPTIONS = ["10-19", "20-49", "50-99", "100-199"] as const;

export const DEFAULT_FILTERS: SearchFilters = {
  fte_klassen: [...FTE_OPTIONS],
  branche: "Alle branches",
  regio_center: null,
  regio_straal_km: 50,
  signaal_query: "",
};

// Geographic centre of the Netherlands — used as the initial map view
// when no pin has been placed yet.
export const NL_CENTER: [number, number] = [52.1, 5.3];

// Builds the streaming status lines the agent "narrates" during a search.
// Delays are randomised per line (500-900ms) to feel human, not uniform.
// Intermediate counts scale with hitCount so the narrative never ends in
// "Top 0 leads" after claiming 91 candidates were filtered.
export function buildSearchSteps(
  filters: SearchFilters,
  hitCount: number,
  relaxation: { regio: boolean; fte: boolean } = { regio: false, fte: false },
): Array<{ text: string; delay: number }> {
  const branche =
    filters.branche === "Alle branches"
      ? "alle branches"
      : filters.branche.toLowerCase();
  const fteRange =
    filters.fte_klassen.length > 0
      ? `${filters.fte_klassen[0].split("-")[0]}-${filters.fte_klassen[filters.fte_klassen.length - 1].split("-")[1]} FTE`
      : "alle groottes";
  const regio = filters.regio_center
    ? `geografisch afgebakend gebied`
    : "heel Nederland";

  const sbiPrefixes = sbiForBranche(filters.branche);
  const initialPool = 140 + Math.floor(Math.random() * 80);

  const lines: string[] = [
    `Query analyseren: ${branche} in ${fteRange}, ${regio}`,
    `Kamer van Koophandel doorzoeken voor SBI-codes ${sbiPrefixes}`,
    `${initialPool} bedrijven in populatie geladen`,
  ];

  if (filters.regio_center) {
    const lat = filters.regio_center.lat.toFixed(3);
    const lng = filters.regio_center.lng.toFixed(3);
    lines.push(
      `Geografische afbakening: radius ${filters.regio_straal_km} km rond [${lat}, ${lng}]`,
    );
    if (relaxation.regio) {
      lines.push(
        `Onvoldoende matches binnen straal — zoekgebied verruimd naar heel Nederland`,
      );
    }
  }

  if (relaxation.fte) {
    lines.push(
      `FTE-selectie (${fteRange}) gaf geen matches — FTE-filter verruimd om relevante leads te tonen`,
    );
  }

  if (hitCount === 0) {
    lines.push(
      `Geen bedrijven voldoen aan de gecombineerde filters — probeer een andere branche of bredere FTE-selectie`,
    );
    return lines.map((text) => ({
      text,
      delay: 300 + Math.floor(Math.random() * 250),
    }));
  }

  // Enrichment numbers scale with hitCount so we never overclaim.
  const refinedCount = Math.max(hitCount + 2, Math.floor(hitCount * 2.5));

  lines.push(
    `Vacature-historie via bedrijfswebsites + sitemaps gescand voor ${refinedCount} bedrijven`,
    `Rechtspraak.nl en KvK-historie gekruist op arbeidsconflicten en FTE-mutaties`,
  );

  if (filters.signaal_query.trim()) {
    lines.push(
      `Aanvullende signalen matchen op: "${filters.signaal_query.trim()}"`,
    );
  }

  lines.push(
    `HR-signalen gedetecteerd bij ${hitCount} ${hitCount === 1 ? "bedrijf" : "bedrijven"}`,
    `Archetypes herkend en gescoord tegen PAVO-dienstenportfolio`,
    `${hitCount} ${hitCount === 1 ? "lead" : "leads"} gepresenteerd op basis van match-kwaliteit`,
  );

  return lines.map((text) => ({
    text,
    delay: 300 + Math.floor(Math.random() * 250),
  }));
}

function sbiForBranche(branche: string): string {
  switch (branche) {
    case "Bouw & installatie":
      return "41, 42, 43";
    case "Logistiek & transport":
      return "49, 52, 53";
    case "Zakelijke dienstverlening":
      return "69, 70, 73, 82";
    case "Productie & techniek":
      return "25, 28, 29";
    case "Retail & e-commerce":
      return "47";
    default:
      return "41, 43, 49, 47, 25, 69";
  }
}

// Detail-page streaming: lead-specific analysis narration.
export function buildLeadSteps(
  lead: { naam: string; archetype: { naam: string } | null },
): Array<{ text: string; delay: number }> {
  const lines = [
    `Bedrijfsgegevens opgehaald uit KvK voor ${lead.naam}`,
    "KvK-historie en bedrijfswebsite geanalyseerd",
    "Vacature-historie via sitemap + JSON-LD scrape (24 mnd)",
    "Rechtspraak.nl gecontroleerd op arbeidsrechtzaken",
    lead.archetype
      ? `Archetype bepaald: ${lead.archetype.naam}`
      : "Geen significant archetype herkend",
    "Match met PAVO-dienstenportfolio berekend",
  ];
  return lines.map((text) => ({
    text,
    delay: 300 + Math.floor(Math.random() * 250),
  }));
}
