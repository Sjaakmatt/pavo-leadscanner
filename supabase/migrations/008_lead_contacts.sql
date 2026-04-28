-- Migration 008 — decision-makers / contacts.
--
-- Twee bronnen voor contacten op een bedrijf:
--   1. KvK basisprofiel.bestuurders (al opgeslagen in kvk_snapshots
--      maar nooit getoond in de UI). Dit zijn de feitelijke
--      tekenbevoegden — meestal directie/eigenaar.
--   2. Website-classifier extracten — Team-/Contact-pagina's leveren
--      vaak HR-manager, CFO, COO etc. die niet als bestuurder geregistreerd
--      staan. Deze komen uit de bestaande get_company_website_content
--      scrape via een nieuwe classifier-output.
--
-- We slaan ze in één tabel met een `bron` discriminator. Idempotent
-- per (kvk, naam, functie) zodat re-scrapes niet dupliceren.

create table if not exists lead_contacts (
  id uuid primary key default gen_random_uuid(),
  kvk text not null references companies(kvk) on delete cascade,
  naam text not null,
  functie text,
  email text,
  telefoon text,
  bron text not null check (bron in ('kvk', 'website', 'handmatig')),
  bron_url text,
  bewijs text,
  detected_at timestamptz not null default now(),
  unique(kvk, naam, functie, bron)
);

create index if not exists idx_lead_contacts_kvk on lead_contacts(kvk);
create index if not exists idx_lead_contacts_bron on lead_contacts(bron);
create index if not exists idx_lead_contacts_detected on lead_contacts(detected_at desc);
