-- Per-tenant rate-limiting + cron-run observability.
--
-- Rate-limit: view die per organisatie het aantal searches vandaag telt.
-- Wordt gebruikt door /api/search om te voorkomen dat één klant het
-- org-budget in één dag opmaakt.
--
-- Cron-runs: tabel om elke cron-uitvoer te loggen (success of failure).
-- /api/cron/health-check leest deze tabel + alert via Slack als er
-- failures zijn binnen het venster van 24u.

-- ---- Rate-limit view -----------------------------------------------------

create or replace view public.daily_search_count as
select
  org_id,
  date_trunc('day', created_at)::date as run_date,
  count(*)::int as search_count
from public.search_queries
where org_id is not null
group by org_id, date_trunc('day', created_at)::date;

comment on view public.daily_search_count is
  'Aantal searches per organisatie per dag. Gebruikt door /api/search rate-limiter.';

-- ---- Cron-runs tabel -----------------------------------------------------

create table if not exists public.cron_runs (
  id uuid primary key default gen_random_uuid(),
  cron_name text not null,
  status text not null check (status in ('success', 'failed')),
  duration_ms int,
  error_message text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cron_runs_name_created_idx
  on public.cron_runs (cron_name, created_at desc);

create index if not exists cron_runs_failed_idx
  on public.cron_runs (created_at desc) where status = 'failed';

comment on table public.cron_runs is
  'Eén rij per cron-uitvoer. /api/cron/health-check alert wanneer er failures zijn in laatste 24u.';

-- RLS: alleen service-role mag schrijven; lezen is voor admins van de
-- defaultorganization (we tonen geen cron-runs in normale klant-UI).
alter table public.cron_runs enable row level security;

create policy "cron_runs_admin_select"
  on public.cron_runs
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
