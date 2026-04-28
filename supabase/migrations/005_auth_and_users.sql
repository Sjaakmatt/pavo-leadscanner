-- Migration 005 — auth + users management.
--
-- 1. profiles: per auth.users row een rij met role + display name.
--    Wordt automatisch aangemaakt bij sign-up via trigger.
-- 2. lead_statuses.owner_id + saved_searches.owner_id → auth.users.id.
--    De oude `owner` text kolom blijft staan voor backwards-compat (en
--    voor demo-mode zonder auth) maar nieuwe rows krijgen owner_id.
-- 3. RLS-policies zodat users alleen hun eigen rows zien (en admins alles).

-- ---------- 1. profiles -----------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'member' check (role in ('admin', 'member')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on profiles(role);
create index if not exists idx_profiles_email on profiles(email);

-- Auto-provisioning bij sign-up. Eerste user die zich aanmeldt krijgt
-- automatisch role=admin zodat de eigenaar binnenkomt zonder dat we
-- handmatig SQL hoeven te draaien. Daarna is iedere nieuwe user
-- standaard 'member'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  is_first boolean;
begin
  select count(*) = 0 into is_first from profiles;
  insert into profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    case when is_first then 'admin' else 'member' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 2. owner_id koppelingen ------------------------------------
alter table lead_statuses
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;
create index if not exists idx_lead_statuses_owner_id on lead_statuses(owner_id);

alter table saved_searches
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;
create index if not exists idx_saved_searches_owner_id on saved_searches(owner_id);

alter table lead_status_history
  add column if not exists owner_id uuid references auth.users(id) on delete set null;
create index if not exists idx_lead_status_history_owner_id on lead_status_history(owner_id);

-- ---------- 3. RLS-policies --------------------------------------------
-- Profiles: iedereen geauthenticeerd ziet alle profiles (voor de users-
-- tab); alleen admins kunnen role/invited_by wijzigen.
alter table profiles enable row level security;

drop policy if exists "profiles_read_authed" on profiles;
create policy "profiles_read_authed" on profiles
  for select to authenticated
  using (true);

drop policy if exists "profiles_self_update" on profiles;
create policy "profiles_self_update" on profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id and role = (select role from profiles where id = auth.uid()));

drop policy if exists "profiles_admin_all" on profiles;
create policy "profiles_admin_all" on profiles
  for all to authenticated
  using (
    exists (
      select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Lead-statuses: zien je eigen, admin ziet alles.
alter table lead_statuses enable row level security;

drop policy if exists "lead_statuses_self" on lead_statuses;
create policy "lead_statuses_self" on lead_statuses
  for all to authenticated
  using (
    owner_id = auth.uid()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    owner_id = auth.uid()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Saved searches idem.
alter table saved_searches enable row level security;

drop policy if exists "saved_searches_self" on saved_searches;
create policy "saved_searches_self" on saved_searches
  for all to authenticated
  using (
    owner_id = auth.uid()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    owner_id = auth.uid()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Companies, signals, scored_leads, search_queries, mcp_raw_responses,
-- kvk_snapshots, lead_status_history blijven service-role-only voor nu;
-- de API-routes draaien met service-role, dus geen RLS nodig om reads
-- te lekken (alleen via API).
