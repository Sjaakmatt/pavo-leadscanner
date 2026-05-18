-- Migration 011 — background search jobs.
--
-- Sales-cases waar de user niet wil wachten:
--   - Hele branche scannen (1000+ KvKs)
--   - Maandelijkse refresh van een saved-search
--
-- Async-flow:
--   1. POST /api/search-jobs creëert row met status='queued'
--   2. /api/cron/search-jobs-runner pakt queued rows en draait ze
--      één voor één (max 1 actieve job per cron-tick zodat we
--      Vercel's maxDuration niet overschrijden)
--   3. Job status updates → 'running' → 'completed'/'failed'
--   4. Notifications.type='system' wanneer klaar zodat de bell
--      meldt dat de search is afgerond
--
-- Scoped op org_id zodat klanten elkaars jobs niet zien. created_by
-- voor accountability.

create table if not exists search_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  filters jsonb not null,
  naam text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  search_query_id uuid references search_queries(id) on delete set null,
  total_leads integer,
  total_cost_usd numeric(10, 6),
  use_batch boolean not null default false,
  error_message text,
  progress jsonb,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_search_jobs_status_queued
  on search_jobs(status, queued_at)
  where status = 'queued';
create index if not exists idx_search_jobs_org_recent
  on search_jobs(org_id, queued_at desc);
create index if not exists idx_search_jobs_creator
  on search_jobs(created_by);

-- RLS: scoped op org + eigen rows; admins zien alle org-rijen.
alter table search_jobs enable row level security;

drop policy if exists "search_jobs_self" on search_jobs;
create policy "search_jobs_self" on search_jobs
  for all to authenticated
  using (
    org_id = (select org_id from profiles where id = auth.uid())
    and (
      created_by = auth.uid()
      or exists (
        select 1 from profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
          and p.org_id = search_jobs.org_id
      )
    )
  )
  with check (
    org_id = (select org_id from profiles where id = auth.uid())
  );
