-- Migration 006 — in-app notifications voor saved-search alerts.
--
-- Eén row per (user, kvk, saved_search) zodat we niet dubbel notificen
-- voor een lead die in meerdere saved-searches matcht. Eenvoudig
-- read-flag + read_at; geen complete inbox-engine nodig.

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_search_id uuid references saved_searches(id) on delete set null,
  kvk text references companies(kvk) on delete cascade,
  type text not null check (type in ('saved_search_match', 'lead_status', 'system')),
  title text not null,
  body text,
  metadata jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, kvk, saved_search_id)
);

create index if not exists idx_notifications_user_unread
  on notifications(user_id, created_at desc)
  where read_at is null;

create index if not exists idx_notifications_user_all
  on notifications(user_id, created_at desc);

-- RLS — alleen eigen rows
alter table notifications enable row level security;

drop policy if exists "notifications_self" on notifications;
create policy "notifications_self" on notifications
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "notifications_self_update" on notifications;
create policy "notifications_self_update" on notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
