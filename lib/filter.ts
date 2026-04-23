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
export function buildSearchSteps(
  filters: SearchFilters,
  hitCount: number,
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

  const initialPool = 120 + Math.floor(Math.random() * 120);
  const afterRadius = Math.max(
    hitCount + 20,
    Math.floor(initialPool * 0.55),
  );
  const afterSignals = Math.max(hitCount, Math.floor(afterRadius * 0.25));

  const lines: string[] = [
    `Query analyseren: ${branche} in ${fteRange}, ${regio}`,
    `Kamer van Koophandel doorzoeken voor SBI-codes ${sbiPrefixes}`,
    `${initialPool} bedrijven gevonden die matchen op sector en grootte`,
  ];

  if (filters.regio_center) {
    const lat = filters.regio_center.lat.toFixed(3);
    const lng = filters.regio_center.lng.toFixed(3);
    lines.push(
      `Geografische afbakening: radius ${filters.regio_straal_km} km rond [${lat}, ${lng}]`,
      `${afterRadius} bedrijven binnen straal gefilterd via haversine-berekening`,
    );
  } else {
    lines.push(`${afterRadius} bedrijven geselecteerd voor signaal-analyse`);
  }

  lines.push(
    `Vacature-historie analyseren via Jobdigger voor ${afterRadius} bedrijven`,
    `Bedrijfswebsites scannen op HR-aanwezigheid en team-paginas`,
    `Rechtspraak.nl controleren op arbeidsrechtzaken`,
    `KvK-historie vergelijken voor FTE-mutaties en bestuurderswissels`,
  );

  if (filters.signaal_query.trim()) {
    lines.push(
      `Aanvullende signalen matchen op: "${filters.signaal_query.trim()}"`,
    );
  }

  lines.push(
    `HR-signalen gedetecteerd bij ${afterSignals} bedrijven`,
    `Archetypes herkend en gescoord tegen PAVO-dienstenportfolio`,
    `Top ${hitCount} leads geselecteerd op basis van match-kwaliteit`,
  );

  return lines.map((text) => ({
    text,
    delay: 500 + Math.floor(Math.random() * 400),
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
    "KvK-historie geanalyseerd (18 maanden)",
    "Bedrijfswebsite gescand op HR-pagina en team-overzicht",
    "Actieve vacatures geïdentificeerd via Jobdigger",
    "Vacature-historie geanalyseerd (24 maanden)",
    "Rechtspraak.nl gecontroleerd op arbeidsrechtzaken",
    "HR-signalen gescoord en gewogen",
    lead.archetype
      ? `Archetype bepaald: ${lead.archetype.naam}`
      : "Geen significant archetype herkend",
    "Match met PAVO-dienstenportfolio berekend",
    "Rapport samengesteld",
  ];
  return lines.map((text) => ({
    text,
    delay: 450 + Math.floor(Math.random() * 350),
  }));
}
