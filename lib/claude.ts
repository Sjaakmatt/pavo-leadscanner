import Anthropic from "@anthropic-ai/sdk";
import leadsData from "@/data/leads.json";
import type { Lead } from "./adapters/types";

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
    .map((s, i) => `${i + 1}. [${s.bron}] ${s.tekst}`)
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
- Altijd onderbouwd vanuit de onderstaande lead-data. Niet verzinnen. Als iets niet in de data staat: zeg dat, en beschrijf hoe je het in productie zou ophalen (Jobdigger, KvK-historie, Rechtspraak.nl, bedrijfswebsite, LinkedIn).
- Schrijf over de agent in de ik-vorm ("ik zie in de signalen dat…").

# PAVO-dienstenportfolio
${diensten}

# PAVO-archetypes (patronen die we herkennen)
${archetypes}

# Productie-context
In productie heb ik via MCP live-toegang tot Jobdigger, KvK (en -historie), Rechtspraak.nl, PDOK geocoding, bedrijfswebsites (headless browser) en LinkedIn-bedrijfspagina's. Hier in de demo werk je met de snapshot hieronder.

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
