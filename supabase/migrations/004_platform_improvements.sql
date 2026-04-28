-- Migration 004 — platform-analyse verbeteringen.
--
-- 1. signals.cluster wordt text zodat 'context' niet meer in NULL valt
-- 2. companies krijgt eindelijk gepersisteerde geocoding (lat/lng)
-- 3. mcp_raw_responses — refresh hoeft scrape niet over te doen voor
--    recente data, en classifier-versies kunnen later replayen
-- 4. scored_leads.scoring_version — A/B-test scoring zonder oude
--    runs ongeldig te maken
-- 5. lead_status — sales-pipeline (nieuw → benaderd → ... → gewonnen)
-- 6. saved_searches — herbruikbare filters per agent/user

-- ---------- 1. signals.cluster naar text -------------------------------
-- We willen "context" en "1"/"2"/"3" allemaal kunnen opslaan. Bestaande
-- integer-waardes worden gecast naar text.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'signals' and column_name = 'cluster'
      and data_type = 'integer'
  ) then
    alter table signals alter column cluster type text using cluster::text;
  end if;
end $$;

-- ---------- 2. companies geocoding -------------------------------------
-- lat/lng zijn al gedeclareerd in 001_initial_schema.sql; we voegen
-- alleen een index toe (al aanwezig) en een geocoded_at zodat we
-- weten wanneer we 'm voor het laatst hebben opgehaald.
alter table companies
  add column if not exists geocoded_at timestamptz;

-- ---------- 3. mcp_raw_responses ---------------------------------------
-- Per (kvk, tool) één meest-recente response cachen. Bij refresh
-- valideren we recency en kunnen we sub-tools (classification) opnieuw
-- draaien zonder MCP-aanroep.
create table if not exists mcp_raw_responses (
  id uuid primary key default gen_random_uuid(),
  kvk text not null references companies(kvk) on delete cascade,
  tool text not null,
  fetched_at timestamptz not null default now(),
  payload jsonb not null,
  bytes integer,
  unique(kvk, tool)
);

create index if not exists idx_mcp_raw_kvk on mcp_raw_responses(kvk);
create index if not exists idx_mcp_raw_tool on mcp_raw_responses(tool);
create index if not exists idx_mcp_raw_fetched on mcp_raw_responses(fetched_at desc);

-- ---------- 4. scored_leads.scoring_version ----------------------------
alter table scored_leads
  add column if not exists scoring_version text;

create index if not exists idx_scored_leads_version on scored_leads(scoring_version);

-- ---------- 5. lead_status (sales-pipeline) ----------------------------
-- Eén row per (kvk, owner). Owner is voorlopig free-text; bij intro van
-- multi-tenant koppelen we 'm aan auth.users.
create table if not exists lead_statuses (
  id uuid primary key default gen_random_uuid(),
  kvk text not null references companies(kvk) on delete cascade,
  owner text not null default 'default',
  status text not null default 'nieuw'
    check (status in ('nieuw', 'shortlist', 'benaderd', 'gesprek', 'gewonnen', 'verloren')),
  reden text,
  notitie text,
  updated_at timestamptz not null default now(),
  updated_by text,
  unique(kvk, owner)
);

create index if not exists idx_lead_statuses_kvk on lead_statuses(kvk);
create index if not exists idx_lead_statuses_owner_status on lead_statuses(owner, status);

create table if not exists lead_status_history (
  id uuid primary key default gen_random_uuid(),
  kvk text not null references companies(kvk) on delete cascade,
  owner text not null default 'default',
  status text not null,
  reden text,
  notitie text,
  changed_at timestamptz not null default now(),
  changed_by text
);

create index if not exists idx_lead_status_history_kvk on lead_status_history(kvk);
create index if not exists idx_lead_status_history_changed on lead_status_history(changed_at desc);

-- ---------- 6. saved_searches ------------------------------------------
create table if not exists saved_searches (
  id uuid primary key default gen_random_uuid(),
  owner text not null default 'default',
  naam text not null,
  filters jsonb not null,
  alert_enabled boolean not null default false,
  alert_last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_saved_searches_owner on saved_searches(owner);
create index if not exists idx_saved_searches_alert on saved_searches(alert_enabled) where alert_enabled = true;
