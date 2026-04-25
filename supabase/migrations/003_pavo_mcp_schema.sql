-- Migration 003 — prod-flow draait nu via FactumAI MCPs i.p.v. in-process
-- scrapers. Daarmee verdwijnt de scrape_runs-tabel als invariant: signals
-- worden direct gepersisteerd onder verwijzing naar de MCP tool-call.

-- 1. signals: scrape_run_id wordt optioneel + add mcp_tool_call_id
alter table signals
  alter column scrape_run_id drop not null;

alter table signals
  add column if not exists mcp_tool_call_id uuid;

create index if not exists idx_signals_bron_type on signals(bron_type);
create index if not exists idx_signals_mcp_call on signals(mcp_tool_call_id);
create index if not exists idx_signals_kvk_detected on signals(kvk, detected_at desc);

-- 2. search_queries: status + current_step + completed_at + error_message
alter table search_queries
  add column if not exists status text not null default 'completed'
    check (status in ('pending', 'running', 'completed', 'failed')),
  add column if not exists current_step text,
  add column if not exists completed_at timestamptz,
  add column if not exists error_message text;

create index if not exists idx_search_queries_status on search_queries(status);

-- 3. scored_leads — ranked output per zoekopdracht. UI leest hieruit
--    voor history, dashboard kan trends per warmte/score plotten.
create table if not exists scored_leads (
  id uuid primary key default gen_random_uuid(),
  search_query_id uuid not null references search_queries(id) on delete cascade,
  kvk text not null references companies(kvk) on delete cascade,
  warmte text not null check (warmte in ('HOT', 'WARM', 'COLD')),
  totale_score integer not null,
  diensten_match jsonb not null,
  samenvatting text,
  created_at timestamptz not null default now()
);

create index if not exists idx_scored_leads_search on scored_leads(search_query_id);
create index if not exists idx_scored_leads_warmte on scored_leads(warmte);
create index if not exists idx_scored_leads_score on scored_leads(totale_score desc);
create index if not exists idx_scored_leads_kvk on scored_leads(kvk);
