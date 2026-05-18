-- Migration 007 — observability + cost tracking.
--
-- 1. search_queries krijgt per-stage timing zodat we performance-
--    bottlenecks kunnen zien zonder een trace-tool. total_cost_usd
--    bestaat al sinds 001 maar werd nog niet gevuld.
-- 2. classification_runs — append-only log van iedere LLM-call (bron,
--    model, tokens, kosten) gekoppeld aan een search_query.
-- 3. companies.last_full_refresh_at — tracking voor de nightly cron
--    zodat we de oudste/active eerst opwarmen.

alter table search_queries
  add column if not exists kvk_ms integer,
  add column if not exists basisprofiel_ms integer,
  add column if not exists geo_ms integer,
  add column if not exists scrape_ms integer,
  add column if not exists score_ms integer,
  add column if not exists classification_calls integer not null default 0,
  add column if not exists classification_input_tokens integer not null default 0,
  add column if not exists classification_output_tokens integer not null default 0,
  add column if not exists budget_exceeded boolean not null default false;

create table if not exists classification_runs (
  id uuid primary key default gen_random_uuid(),
  search_query_id uuid references search_queries(id) on delete cascade,
  kvk text references companies(kvk) on delete set null,
  bron_type text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_creation_tokens integer not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_classification_runs_search
  on classification_runs(search_query_id);
create index if not exists idx_classification_runs_kvk
  on classification_runs(kvk);
create index if not exists idx_classification_runs_created
  on classification_runs(created_at desc);

alter table companies
  add column if not exists last_full_refresh_at timestamptz;

create index if not exists idx_companies_last_refresh
  on companies(last_full_refresh_at nulls first);
