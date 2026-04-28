// Persistence + read voor lead_contacts (decision-makers per bedrijf).
//
// KvK-bestuurders worden bij iedere upsertCompanies-call mee-gepersisteerd
// (daar ligt het basisprofiel paraat). Website-extracted contacten
// komen uit de classifier en worden in de orchestrator-laag opgeslagen.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { KvkBestuurder } from "@/lib/kvk/types";

export type ContactBron = "kvk" | "website" | "handmatig";

export type LeadContact = {
  id: string;
  kvk: string;
  naam: string;
  functie: string | null;
  email: string | null;
  telefoon: string | null;
  bron: ContactBron;
  bron_url: string | null;
  bewijs: string | null;
  detected_at: string;
};

export type ContactInsert = {
  kvk: string;
  naam: string;
  functie?: string | null;
  email?: string | null;
  telefoon?: string | null;
  bron: ContactBron;
  bron_url?: string | null;
  bewijs?: string | null;
};

// Upsert KvK-bestuurders bij een bedrijf. We dedupliceren op
// (kvk, naam, functie, bron) zodat re-runs geen dupes maken.
export async function upsertKvkBestuurders(
  supabase: SupabaseClient,
  kvk: string,
  bestuurders: KvkBestuurder[],
): Promise<void> {
  if (bestuurders.length === 0) return;
  const rows: ContactInsert[] = bestuurders
    .filter((b) => b.naam && b.naam.trim())
    .map((b) => ({
      kvk,
      naam: b.naam.trim(),
      functie: b.functie ?? null,
      bron: "kvk",
      bewijs: b.sinds ? `Bestuurder sinds ${b.sinds}` : null,
    }));
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("lead_contacts")
    .upsert(rows, { onConflict: "kvk,naam,functie,bron", ignoreDuplicates: true });
  if (error) {
    console.warn(`[contacts] kvk upsert ${kvk}: ${error.message}`);
  }
}

export async function upsertWebsiteContacts(
  supabase: SupabaseClient,
  kvk: string,
  contacts: Array<{
    naam: string;
    functie?: string;
    email?: string;
    telefoon?: string;
    bronUrl?: string;
    bewijs?: string;
  }>,
): Promise<void> {
  if (contacts.length === 0) return;
  const rows: ContactInsert[] = contacts
    .filter((c) => c.naam && c.naam.trim())
    .map((c) => ({
      kvk,
      naam: c.naam.trim(),
      functie: c.functie ?? null,
      email: c.email ?? null,
      telefoon: c.telefoon ?? null,
      bron: "website",
      bron_url: c.bronUrl ?? null,
      bewijs: c.bewijs ?? null,
    }));
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("lead_contacts")
    .upsert(rows, { onConflict: "kvk,naam,functie,bron", ignoreDuplicates: true });
  if (error) {
    console.warn(`[contacts] website upsert ${kvk}: ${error.message}`);
  }
}

export async function fetchContacts(
  supabase: SupabaseClient,
  kvk: string,
): Promise<LeadContact[]> {
  const { data } = await supabase
    .from("lead_contacts")
    .select(
      "id, kvk, naam, functie, email, telefoon, bron, bron_url, bewijs, detected_at",
    )
    .eq("kvk", kvk)
    .order("bron", { ascending: true })
    .order("detected_at", { ascending: false });
  return (data ?? []) as LeadContact[];
}
