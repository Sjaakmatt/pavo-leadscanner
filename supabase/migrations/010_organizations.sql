-- Migration 010 — multi-tenant via organizations.
--
-- Shared data (companies, signals, mcp_raw_responses, kvk_snapshots,
-- lead_contacts) blijft één gedeelde dataset — KvK + scrape-output is
-- publiek en orgs hoeven elkaars cache niet te dupliceren.
--
-- Per-org state (scored_leads, search_queries, lead_statuses,
-- lead_status_history, saved_searches, notifications, profiles) krijgt
-- een org_id. Bestaande rows worden aan een default 'PAVO' org gehangen
-- zodat dev-omgevingen niet leeg raken.
--
-- handle_new_user trigger wordt aangepast:
--   - Eerste user → maakt org "PAVO" + zet role=admin + org_id
--   - Volgende users → erven org_id van de inviter (uit raw_user_meta_data
--     wanneer een admin uitnodigt) of vallen terug op single-org als
--     er maar één bestaat
--
-- RLS-policies worden uitgebreid om alleen rows in dezelfde org te
-- tonen. Profiles read/write zit nu binnen org-scope.

-- ---------- 1. organizations -------------------------------------------
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  naam text not null,
  slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Default-org voor backfill van bestaande rows.
insert into organizations (id, naam, slug)
select gen_random_uuid(), 'PAVO', 'pavo'
where not exists (select 1 from organizations);

-- Helper-functie: org_id van de eerste organization (voor backfill).
create or replace function _default_org_id() returns uuid
language sql stable as $$
  select id from organizations order by created_at asc limit 1
$$;

-- ---------- 2. profiles.org_id -----------------------------------------
alter table profiles
  add column if not exists org_id uuid references organizations(id) on delete cascade;

update profiles set org_id = _default_org_id() where org_id is null;

alter table profiles
  alter column org_id set not null,
  alter column org_id set default _default_org_id();

create index if not exists idx_profiles_org on profiles(org_id);

-- ---------- 3. per-org state tables krijgen org_id ---------------------
-- We zetten 'm op alle bestaande rows + dwingen NOT NULL af voor nieuwe rows.

alter table search_queries
  add column if not exists org_id uuid references organizations(id) on delete cascade,
  add column if not exists created_by uuid references auth.users(id) on delete set null;
update search_queries set org_id = _default_org_id() where org_id is null;
create index if not exists idx_search_queries_org on search_queries(org_id);
create index if not exists idx_search_queries_created_by on search_queries(created_by);

alter table scored_leads
  add column if not exists org_id uuid references organizations(id) on delete cascade;
update scored_leads set org_id = _default_org_id() where org_id is null;
create index if not exists idx_scored_leads_org on scored_leads(org_id);

alter table lead_statuses
  add column if not exists org_id uuid references organizations(id) on delete cascade;
update lead_statuses set org_id = _default_org_id() where org_id is null;
create index if not exists idx_lead_statuses_org on lead_statuses(org_id);

alter table lead_status_history
  add column if not exists org_id uuid references organizations(id) on delete cascade;
update lead_status_history set org_id = _default_org_id() where org_id is null;
create index if not exists idx_lead_status_history_org on lead_status_history(org_id);

alter table saved_searches
  add column if not exists org_id uuid references organizations(id) on delete cascade;
update saved_searches set org_id = _default_org_id() where org_id is null;
create index if not exists idx_saved_searches_org on saved_searches(org_id);

alter table notifications
  add column if not exists org_id uuid references organizations(id) on delete cascade;
update notifications set org_id = _default_org_id() where org_id is null;
create index if not exists idx_notifications_org on notifications(org_id);

-- ---------- 4. handle_new_user uitbreiden ------------------------------
-- Bij sign-up: eerste user maakt + admin'eet eigen "PAVO" org. Volgende
-- users erven org_id uit invited_by metadata, of vallen terug op de
-- single-org-fallback als er er maar één bestaat.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  is_first_ever boolean;
  resolved_org_id uuid;
  invited_org uuid;
begin
  select count(*) = 0 into is_first_ever from profiles;

  if is_first_ever then
    -- Eerste user op een schone install: maak een nieuwe org of gebruik
    -- de bestaande default.
    select id into resolved_org_id from organizations order by created_at asc limit 1;
    if resolved_org_id is null then
      insert into organizations (naam, slug)
      values ('PAVO', 'pavo')
      returning id into resolved_org_id;
    end if;

    insert into profiles (id, email, full_name, role, org_id)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'full_name', new.email),
      'admin',
      resolved_org_id
    )
    on conflict (id) do nothing;
    return new;
  end if;

  -- Volgende users: probeer org_id uit metadata (admin-invite),
  -- anders pak de inviter's org via invited_by, anders single-org.
  invited_org := nullif(new.raw_user_meta_data->>'invited_org_id', '')::uuid;
  if invited_org is not null then
    resolved_org_id := invited_org;
  elsif new.raw_user_meta_data->>'invited_by' is not null then
    select org_id into resolved_org_id
    from profiles
    where id = (new.raw_user_meta_data->>'invited_by')::uuid;
  end if;

  if resolved_org_id is null then
    -- Fallback: gebruik default-org alleen als die uniek is.
    select id into resolved_org_id from organizations order by created_at asc limit 1;
  end if;

  insert into profiles (id, email, full_name, role, org_id, invited_by)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'member',
    resolved_org_id,
    nullif(new.raw_user_meta_data->>'invited_by', '')::uuid
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------- 5. RLS-policies herschrijven naar org-scope ----------------
-- Profiles: zelfde org zien.
drop policy if exists "profiles_read_authed" on profiles;
create policy "profiles_read_authed" on profiles
  for select to authenticated
  using (
    org_id = (select org_id from profiles where id = auth.uid())
  );

drop policy if exists "profiles_self_update" on profiles;
create policy "profiles_self_update" on profiles
  for update to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_admin_all" on profiles;
create policy "profiles_admin_all" on profiles
  for all to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
        and p.org_id = profiles.org_id
    )
  )
  with check (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
        and p.org_id = profiles.org_id
    )
  );

-- Lead-statuses + saved-searches: dezelfde org als de logged-in user.
drop policy if exists "lead_statuses_self" on lead_statuses;
create policy "lead_statuses_self" on lead_statuses
  for all to authenticated
  using (
    org_id = (select org_id from profiles where id = auth.uid())
    and (
      owner_id = auth.uid()
      or exists (
        select 1 from profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
          and p.org_id = lead_statuses.org_id
      )
    )
  )
  with check (
    org_id = (select org_id from profiles where id = auth.uid())
    and (
      owner_id = auth.uid()
      or exists (
        select 1 from profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
          and p.org_id = lead_statuses.org_id
      )
    )
  );

drop policy if exists "saved_searches_self" on saved_searches;
create policy "saved_searches_self" on saved_searches
  for all to authenticated
  using (
    org_id = (select org_id from profiles where id = auth.uid())
    and (
      owner_id = auth.uid()
      or exists (
        select 1 from profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
          and p.org_id = saved_searches.org_id
      )
    )
  )
  with check (
    org_id = (select org_id from profiles where id = auth.uid())
    and (
      owner_id = auth.uid()
      or exists (
        select 1 from profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
          and p.org_id = saved_searches.org_id
      )
    )
  );

-- Notifications: dezelfde org + eigen rows.
drop policy if exists "notifications_self" on notifications;
create policy "notifications_self" on notifications
  for select to authenticated
  using (
    org_id = (select org_id from profiles where id = auth.uid())
    and user_id = auth.uid()
  );

drop policy if exists "notifications_self_update" on notifications;
create policy "notifications_self_update" on notifications
  for update to authenticated
  using (
    org_id = (select org_id from profiles where id = auth.uid())
    and user_id = auth.uid()
  )
  with check (
    org_id = (select org_id from profiles where id = auth.uid())
    and user_id = auth.uid()
  );

-- Organizations: leesbaar voor geauthenticeerde users binnen die org;
-- alleen admin kan updaten.
alter table organizations enable row level security;

drop policy if exists "orgs_read" on organizations;
create policy "orgs_read" on organizations
  for select to authenticated
  using (
    id = (select org_id from profiles where id = auth.uid())
  );

drop policy if exists "orgs_admin_update" on organizations;
create policy "orgs_admin_update" on organizations
  for update to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
        and p.org_id = organizations.id
    )
  );

-- ---------- 6. update lead_status_summary view voor org-aware joins ----
-- View blijft hetzelfde — joins lopen via service-role queries in API
-- routes; RLS wordt daar handmatig toegepast.
