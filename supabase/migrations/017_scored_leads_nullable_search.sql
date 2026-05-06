-- scored_leads.search_query_id nullable maken zodat re-scores van
-- individuele leads (bv. via /api/lead/[kvk] na schema-stale-refresh
-- of na bulk-refresh-script met --with-llm) opgeslagen kunnen worden
-- zonder een synthetic search_queries-row aan te maken.
--
-- Lead-list/Geschiedenis-pagina ranked op meest recente scored_leads-rij
-- per kvk. Zonder deze fix bleef de warmte stale na een rescrape.

alter table scored_leads
  alter column search_query_id drop not null;

comment on column scored_leads.search_query_id is
  'NULL = re-score zonder originele search-context (bv. lead-detail open na cache-refresh, bulk-refresh-script). Niet-NULL voor scoring tijdens een full search.';
