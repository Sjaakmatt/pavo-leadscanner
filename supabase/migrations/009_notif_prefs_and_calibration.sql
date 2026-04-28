-- Migration 009 — notification preferences + calibration view.
--
-- 1. profiles krijgt notification-preferences zodat users zelf
--    kunnen kiezen of ze e-mails willen voor saved-search-matches en/of
--    lead-status-events. In-app meldingen blijven altijd aan.
-- 2. lead_conversion_stats — view die per warmte/archetype/dienst-code
--    laat zien hoeveel leads er zijn aangeleverd en welk percentage
--    'gewonnen' is. Dit is de eerste calibration-data: helpt straks
--    bij het tunen van CLUSTER_POINTS.

-- ---------- 1. notification preferences --------------------------------
alter table profiles
  add column if not exists notif_email_alerts boolean not null default true,
  add column if not exists notif_email_team boolean not null default true;

-- ---------- 2. conversion-stats views ----------------------------------
-- Per (warmte) totaal en gewonnen.
create or replace view lead_conversion_by_warmte as
select
  sl.warmte,
  count(distinct sl.kvk) as leads,
  count(distinct ls.kvk) filter (where ls.status = 'gewonnen') as gewonnen,
  count(distinct ls.kvk) filter (where ls.status = 'verloren') as verloren
from scored_leads sl
left join lead_statuses ls on ls.kvk = sl.kvk
group by sl.warmte;

-- Per archetype (uit scored_leads samenvatting JSON, plus join met
-- meest recente status). We pakken het archetype uit de scored_leads
-- diensten_match-array niet — archetype zit in de samenvatting maar
-- niet als kolom. Voor v1 lezen we 'm uit een nested JSON-velden
-- query in de backend; deze view geeft alleen de status-distributie
-- per kvk zodat de backend kan groeperen.
create or replace view lead_status_summary as
select
  sl.kvk,
  sl.warmte,
  sl.totale_score,
  sl.created_at as scored_at,
  ls.status,
  ls.updated_at as status_updated_at,
  ls.reden
from scored_leads sl
left join lateral (
  select status, updated_at, reden
  from lead_statuses
  where kvk = sl.kvk
  order by updated_at desc
  limit 1
) ls on true;

create index if not exists idx_lead_statuses_status_updated
  on lead_statuses(status, updated_at desc);
