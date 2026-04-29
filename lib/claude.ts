import Anthropic from "@anthropic-ai/sdk";
import leadsData from "@/data/leads.json";
import type { Bron, Lead } from "./adapters/types";

// Classificatie van bron-sterkte. Feitelijk = verifieerbare registers
// en externe databanken; Interpretatief = gepubliceerde content waar
// de agent iets uit afleidt (kan achterhaald of incompleet zijn).
export type BronSterkte = "Feitelijk" | "Interpretatief";

const HARD_BRONNEN: Bron[] = [
  "KvK",
  "KvK-historie",
  "KvK-deponering",
  "Rechtspraak.nl",
  "NLA",
  "Insolventieregister",
  "CBS",
  "Vacatures",
];

export function bronSterkte(bron: Bron): BronSterkte {
  return HARD_BRONNEN.includes(bron) ? "Feitelijk" : "Interpretatief";
}

// The dienstenportfolio lives in the dataset meta — reuse it so the
// agent's explanation of D-codes stays in sync with what the UI shows.
type Meta = {
  diensten: Record<string, string>;
  archetypes: Record<string, string>;
  archetype_beschrijvingen: Record<string, string>;
};

const meta = (leadsData as unknown as { meta: Meta }).meta;

export const CHAT_MODEL = "claude-sonnet-4-6";
export const CHAT_MAX_TOKENS = 1024;
export const BRIEFING_MAX_TOKENS = 700;
export const SUMMARY_MAX_TOKENS = 250;

// Identical shape to a user turn — we reuse the full chat system prompt
// (persona + portfolio + lead data) so the briefing and the chat share
// the same cached prefix. First call: full cost. Every chat question
// about the same lead after: cache HIT.
//
// Output-vorm is bewust BULLET-gebaseerd zodat de UI compact en
// scanbaar blijft (zie components/LeadBriefing.tsx::BriefingMarkdown
// voor de renderer).
export const BRIEFING_USER_PROMPT = `Schrijf een beknopte, scanbare briefing voor de PAVO-consultant die dit dossier opent. Antwoord op één vraag: "waarom is dit een goede lead en welke data heeft dat opgeleverd?"

Dit is GEEN gespreksvoorbereiding. Geen lange paragrafen. Geen verkoopaanpak.

### Citaties zijn VERPLICHT
Elk signaal in de lead-data heeft een nummer tussen blokhaken (bijv. [1], [2]). Wanneer je een bewering doet die op een signaal is gebaseerd, MOET je het relevante signaal-nummer direct achter die bewering plaatsen in exact het formaat [N] of [N,M]. Geen "(zie signaal 1)" of "volgens signaal 1". Beweringen zonder citatie zijn niet toegestaan, tenzij ze expliciet over het archetype, de bron-sterkte of de PAVO-dienstmatch gaan.

### Output-format
Gebruik EXACT de volgende structuur. Iedere sectie begint met een \`## \` kop en bestaat uit Markdown-bullets met \`- \`. Geen paragrafen, geen genummerde lijsten, geen subkoppen.

## Waarom een lead
- 3 tot 5 bullets, max 18 woorden per bullet.
- Elke bullet noemt één concrete reden + cite [N]. Geen filler.
- Combineer signalen waar logisch ("vacatures + geen HR + groei [1,3,5]").

## Wat we zagen
- 3 tot 5 bullets, gegroepeerd per bron-type.
- Begin elke bullet met de bron in **vet** ("**Bedrijfswebsite:** …", "**Vacatures:** …", "**KvK:** …", "**Rechtspraak.nl:** …", "**Nieuws:** …").
- Citeer concrete getallen of feiten. Citatie [N] aan het eind.
- Géén bron herhalen — pak per bron de sterkste observatie.

## Risico's & nuances
- 1 tot 3 bullets met dingen die NIET kloppen, ontbreken, of voorzichtig moeten worden geïnterpreteerd.
- Onderscheid Feitelijk (registers) vs Interpretatief (publieke content). Citeer waar van toepassing.

## Voorgestelde focus
- 1 tot 2 bullets met de meest passende PAVO-dienst (D-code) op basis van de match-score, met korte motivatie.
- Geen openingszinnen, alleen WAT er aangepakt moet worden.

Toon: zakelijk, analytisch, Nederlands. Totaal max 250 woorden.`;

export function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY ontbreekt. Zet 'm in Vercel (Settings → Environment Variables) of in een lokale .env.local.",
    );
  }
  return new Anthropic({ apiKey });
}

// Builds the system prompt. Its bytes are stable per-lead, so a cache
// breakpoint here gives us ~90% input-token discount on follow-up
// questions about the same lead.
export function buildSystemPrompt(lead: Lead): string {
  const diensten = Object.entries(meta.diensten)
    .map(([code, naam]) => `- ${code}: ${naam}`)
    .join("\n");

  const archetypes = Object.entries(meta.archetype_beschrijvingen)
    .map(
      ([code, beschrijving]) =>
        `- ${code} ${meta.archetypes[code]}: ${beschrijving}`,
    )
    .join("\n");

  const signalen = lead.signalen
    .map(
      (s, i) =>
        `[${i + 1}] (${s.bron} — ${bronSterkte(s.bron)}) ${s.tekst}`,
    )
    .join("\n");

  const dienstMatch = lead.diensten
    .map(
      (d) =>
        `- ${d.code} ${d.naam} (${d.prioriteit}, score ${d.score}%)`,
    )
    .join("\n");

  const archetypeSectie = lead.archetype
    ? `Archetype: ${lead.archetype.code} — ${lead.archetype.naam}\n${lead.archetype.beschrijving}`
    : "Geen significant archetype gedetecteerd.";

  return `Je bent de PAVO Research Agent. Je hebt zojuist een MKB-lead geanalyseerd voor FactumAI en PAVO HR (pavohr.nl). Je beantwoordt vervolgvragen van de PAVO-consultant over deze specifieke lead.

# Stijl
- Nederlands, zakelijk, bondig. Geen opsommingen langer dan nodig. Geen uitroeptekens, geen emojis.
- Antwoorden van 2-4 zinnen tenzij de vraag expliciet om meer vraagt.
- Altijd onderbouwd vanuit de onderstaande lead-data. Niet verzinnen. Als iets niet in de data staat: zeg dat, en beschrijf hoe je het in productie zou ophalen (vacature-scrape, KvK-historie, Rechtspraak.nl, bedrijfswebsite, LinkedIn).
- Schrijf over de agent in de ik-vorm ("ik zie in de signalen dat…").

# PAVO-dienstenportfolio
${diensten}

# PAVO-archetypes (patronen die we herkennen)
${archetypes}

# Productie-context
In productie heb ik via MCP live-toegang tot vacature-scraping (sitemap + JSON-LD), KvK (en -historie), Rechtspraak.nl, PDOK geocoding, bedrijfswebsites (headless browser) en LinkedIn-bedrijfspagina's. Hier in de demo werk je met de snapshot hieronder.

# Lead-data (snapshot)
Naam: ${lead.naam}
KvK: ${lead.kvk}
Sector: ${lead.sector}
Plaats: ${lead.plaats}, ${lead.provincie}
FTE-klasse: ${lead.fte_klasse}
Warmte: ${lead.warmte}

${archetypeSectie}

## Gedetecteerde signalen (${lead.signalen.length})
${signalen || "Geen signalen gedetecteerd."}

## Match met PAVO-diensten
${dienstMatch || "Geen dienst-matches."}

## Observatie van de agent
${lead.observatie}`;
}

export type SummaryLead = {
  naam: string;
  plaats: string;
  warmte: Lead["warmte"];
  fte_klasse: Lead["fte_klasse"];
  archetype: string | null;
  top_signaal: string | null;
  dienst_codes: string[];
};

// Compact projection of a lead — only the fields the summary prompt
// needs. Keeps the user-prompt short (and the total context modest).
export function projectLeadForSummary(lead: Lead): SummaryLead {
  return {
    naam: lead.naam,
    plaats: lead.plaats,
    warmte: lead.warmte,
    fte_klasse: lead.fte_klasse,
    archetype: lead.archetype?.naam ?? null,
    top_signaal: lead.signalen[0]?.tekst ?? null,
    dienst_codes: lead.diensten
      .filter((d) => d.prioriteit === "primair")
      .map((d) => d.code),
  };
}

export function buildSummarySystemPrompt(): string {
  return `Je bent de PAVO Research Agent. Je hebt zojuist een zoekopdracht afgerond en presenteert een korte samenvatting over het hele resultaat-set aan de PAVO-consultant.

Stijl: Nederlands, zakelijk, bondig. Geen verkooppraatje. Geen opsommingstekens.

Regels voor de samenvatting:
- 2 of 3 zinnen. Maximum 80 woorden totaal.
- Zin 1: welk patroon de leads delen (sector, groeifase, archetype-cluster, of "geen duidelijk patroon").
- Zin 2: welke lead het meest opvalt en waarom (noem het bedrijf bij naam).
- Zin 3 (optioneel): een lead die zwakker onderbouwd is of waarbij de agent voorzichtig zou zijn, of een zinvolle nuance.
- Citeer specifieke feiten (groeicijfers, archetype-labels) waar mogelijk — niet generiek.

Geen verkooppraatje. Geen "je kunt het beste X bellen". Dit is een analyse, geen actie-advies.`;
}

export function buildSummaryUserPrompt(
  filters: {
    branche: string;
    fte_klassen: readonly string[];
    regio_center: { lat: number; lng: number } | null;
    regio_straal_km: number;
  },
  leads: SummaryLead[],
): string {
  const filterSummary = `Branche: ${filters.branche} · FTE: ${filters.fte_klassen.join(", ") || "alle"} · Regio: ${filters.regio_center ? `${filters.regio_straal_km} km rond [${filters.regio_center.lat.toFixed(2)}, ${filters.regio_center.lng.toFixed(2)}]` : "heel Nederland"}`;

  const leadRows = leads
    .map((l, i) => {
      const parts = [
        `${i + 1}. ${l.naam} (${l.plaats}, ${l.fte_klasse} FTE, ${l.warmte})`,
      ];
      if (l.archetype) parts.push(`   archetype: ${l.archetype}`);
      if (l.top_signaal) parts.push(`   top-signaal: ${l.top_signaal}`);
      if (l.dienst_codes.length > 0)
        parts.push(`   primaire diensten: ${l.dienst_codes.join(", ")}`);
      return parts.join("\n");
    })
    .join("\n");

  return `Filters: ${filterSummary}

${leads.length} ${leads.length === 1 ? "lead" : "leads"} gevonden:

${leadRows}

Schrijf de samenvatting volgens de instructies.`;
}
