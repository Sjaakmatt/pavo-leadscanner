-- 013_lead_briefings.sql
--
-- Cache-tabel voor agent-briefings op /lead/[kvk]. Voorkomt dat we
-- elke pagina-open opnieuw Anthropic aanroepen voor dezelfde lead-data.
--
-- Cache-invalidatie: signals_hash is een SHA256 over de gebruikte
-- lead-inputs (signalen-tekst, archetype, dienstmatch, observatie).
-- Volgende scan met andere/meer signalen → andere hash → cache miss →
-- briefing wordt opnieuw gegenereerd. Geen TTL nodig: data-driven.

create table if not exists public.lead_briefings (
  kvk text primary key,
  briefing_md text not null,
  signals_hash text not null,
  model text not null,
  generated_at timestamptz not null default now()
);

create index if not exists lead_briefings_signals_hash_idx
  on public.lead_briefings (kvk, signals_hash);

comment on table public.lead_briefings is
  'Cache van agent-gegenereerde lead-briefings. Eén row per KvK; row wordt overschreven bij hash-mismatch (nieuwe signalen). Verlaagt Anthropic-kosten — een geopende lead in geschiedenis triggert geen LLM-call meer tenzij er een nieuwe scan is geweest.';
