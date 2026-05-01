-- Migration 012 — persistente snapshots voor trend-detectie.
--
-- Twee nieuwe tabellen die signalen uit de leadscanner-audit mogelijk
-- maken waarvoor we historie nodig hebben (een momentopname is
-- onvoldoende):
--
--  1. kvk_snapshots  — FTE-bucket + vestigingen per dag → snelle_groei,
--                      nieuwe_managementlaag detectie. production.ts
--                      schreef hier al naar maar de tabel ontbrak;
--                      eindelijk gedeclareerd. Trend-detectie volgt zodra
--                      er minimaal 2 snapshot-dagen historie is opgebouwd.
--  2. vacature_snapshots — vacature-titels + url + first_seen_at per
--                      bedrijf → herposte_vacatures detectie ACROSS
--                      meerdere scrape-runs (de classifier doet 'm al
--                      BINNEN één run via dup-titels; deze tabel vult
--                      dat aan met inter-run repost detectie).
--                      Wanneer een titel/url eerder dan TTL_DAYS terug
--                      voor het laatst weg was en nu weer aanwezig is
--                      = herpost.
--
-- Beide tabellen hebben unique-keys zodat dagelijkse cron-runs
-- idempotent zijn; on-conflict do-nothing op INSERT.

-- ---------- 1. kvk_snapshots -----------------------------------------
create table if not exists kvk_snapshots (
  id uuid primary key default gen_random_uuid(),
  kvk text not null references companies(kvk) on delete cascade,
  snapshot_at timestamptz not null default now(),
  fte_klasse text,
  raw_data jsonb not null,
  bestuurders jsonb,
  vestigingen jsonb,
  -- Max 1 snapshot per kvk per kalenderdag — voorkomt dat een refresh
  -- per ongeluk een rij dubbel toevoegt. Cron draait 1x/dag.
  unique(kvk, snapshot_at)
);

-- Snel ophalen van de laatste N snapshots per kvk voor trend-analyse.
create index if not exists idx_kvk_snapshots_kvk_at
  on kvk_snapshots(kvk, snapshot_at desc);

-- ---------- 2. vacature_snapshots ------------------------------------
-- Eén row per (kvk, vacature_url). first_seen_at = eerste keer dat we
-- 'm zagen, last_seen_at = meest recente run waar 'm nog open was.
-- Wanneer vacature minimaal 14 dagen weg was en nu weer terugkomt
-- (= last_seen_at < now - 14d EN nu actief) → herposte_vacature.
create table if not exists vacature_snapshots (
  id uuid primary key default gen_random_uuid(),
  kvk text not null references companies(kvk) on delete cascade,
  vacature_url text not null,
  vacature_title text not null,
  date_posted timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  source text,
  unique(kvk, vacature_url)
);

create index if not exists idx_vacature_snapshots_kvk
  on vacature_snapshots(kvk);
create index if not exists idx_vacature_snapshots_last_seen
  on vacature_snapshots(last_seen_at desc);

-- Helper-view: per kvk de count van vacatures die eerder weg waren en
-- nu terug zijn binnen 60 dagen. Gebruik in scoring/orchestrator om
-- het herposte_vacatures-signaal deterministisch af te leiden ACROSS
-- runs (de classifier doet binnen-één-run dup-detectie via job-titels).
create or replace view vacature_repost_summary as
select
  kvk,
  count(*) filter (
    where last_seen_at >= now() - interval '7 days'
      and first_seen_at < last_seen_at - interval '14 days'
  ) as repost_count_60d,
  max(last_seen_at) as last_observed_at
from vacature_snapshots
group by kvk;

comment on table kvk_snapshots is
  'Daily snapshot van KvK-basisprofiel per bedrijf. Levert FTE-trend en bestuurders-mutaties voor signalen snelle_groei en nieuwe_managementlaag.';
comment on table vacature_snapshots is
  'Per bedrijf alle ooit-geobserveerde vacatures. first_seen_at + last_seen_at maakt inter-run herpost-detectie mogelijk (signaal herposte_vacatures across scrape-runs).';
