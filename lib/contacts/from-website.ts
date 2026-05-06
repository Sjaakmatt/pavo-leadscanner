// Deterministische contact-extractie uit gescrapete website-pages.
//
// Twee bronnen:
//   - JSON-LD ContactPoint (Schema.org Organization/ContactPoint blocks)
//   - <a href="mailto:..."> + <a href="tel:..."> anchors uit raw HTML
//
// De extractie zelf gebeurt al in mcp-bedrijven (shared/scraping/json-ld
// + contact-links); deze module mapt de ScrapedPage-output naar
// ContactInsert-rijen en persisteert ze.
//
// Voordeel boven LLM-extractie:
//   - Gratis, instant (geen Anthropic-call)
//   - Hoge betrouwbaarheid (regex/JSON over structured markup)
//   - Pakt 'info@' / '+31 20 ...' die LLM nu mist omdat ze in HTML-
//     attributes staan, niet in cleaned text

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactInsert } from "@/lib/lead-source/contacts";

type ContactPoint = {
  email?: string;
  telephone?: string;
  contactType?: string;
  name?: string;
};

type ContactLink = {
  kind: "email" | "phone";
  value: string;
  anchorText?: string;
};

type PageWithContacts = {
  url: string;
  contactPoints?: ContactPoint[];
  contactLinks?: ContactLink[];
};

/**
 * Map alle ContactPoints + contact-anchors uit gescrapete pages naar
 * ContactInsert-rijen. Eén rij per (email|telefoon, bron-type, page).
 */
export function deriveContactsFromPages(
  kvk: string,
  pages: PageWithContacts[],
): ContactInsert[] {
  const out: ContactInsert[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    // JSON-LD ContactPoints — meestal 1 algemeen contact per Organization.
    for (const cp of page.contactPoints ?? []) {
      const naam = cp.name?.trim() || generieke(cp.contactType);
      const email = cp.email?.trim() || null;
      const telefoon = cp.telephone?.trim() || null;
      if (!email && !telefoon) continue;
      const key = `jsonld|${(email ?? "").toLowerCase()}|${(telefoon ?? "").replace(/\s+/g, "")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kvk,
        naam,
        functie: cp.contactType ?? null,
        email,
        telefoon,
        bron: "website-jsonld",
        bron_url: page.url,
        bewijs: cp.contactType
          ? `Schema.org ContactPoint (${cp.contactType})`
          : "Schema.org Organization/ContactPoint",
      });
    }

    // Anchor-links uit raw HTML (mailto: / tel:).
    for (const link of page.contactLinks ?? []) {
      if (link.kind === "email") {
        const email = link.value.trim();
        const key = `regex|email|${email.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          kvk,
          naam: link.anchorText?.trim() || labelVoorEmail(email),
          functie: null,
          email,
          telefoon: null,
          bron: "website-regex",
          bron_url: page.url,
          bewijs: link.anchorText
            ? `Anchor-tekst: "${link.anchorText.slice(0, 80)}"`
            : `mailto: link in pagina`,
        });
      } else {
        const tel = link.value.trim();
        const key = `regex|phone|${tel.replace(/\s+/g, "")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          kvk,
          naam: link.anchorText?.trim() || "Algemeen telefoonnummer",
          functie: null,
          email: null,
          telefoon: tel,
          bron: "website-regex",
          bron_url: page.url,
          bewijs: link.anchorText
            ? `Anchor-tekst: "${link.anchorText.slice(0, 80)}"`
            : `tel: link in pagina`,
        });
      }
    }
  }

  return out;
}

/**
 * Persist deterministisch gevonden contacten via dezelfde upsert-flow
 * als de LLM-extractie. Best-effort — fouten blokkeren de pipeline niet.
 */
export async function upsertDeterministicContacts(
  supabase: SupabaseClient,
  rows: ContactInsert[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("lead_contacts")
    .upsert(rows, {
      onConflict: "kvk,naam,functie,bron",
      ignoreDuplicates: true,
    });
  if (error) {
    console.warn(`[contacts] deterministic upsert: ${error.message}`);
  }
}

function generieke(contactType: string | undefined): string {
  if (!contactType) return "Algemeen contact";
  const lower = contactType.toLowerCase();
  if (lower.includes("sales")) return "Sales";
  if (lower.includes("hr") || lower.includes("recruit")) return "HR";
  if (lower.includes("support") || lower.includes("service")) return "Klantenservice";
  if (lower.includes("press") || lower.includes("media")) return "Pers";
  return contactType;
}

function labelVoorEmail(email: string): string {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local === "info" || local === "contact") return "Algemeen contact";
  if (local === "sales") return "Sales";
  if (local === "hr" || local === "recruitment") return "HR";
  if (local === "support" || local === "service" || local === "klantenservice")
    return "Klantenservice";
  if (local === "pers" || local === "media") return "Pers";
  return "Algemeen contact";
}
