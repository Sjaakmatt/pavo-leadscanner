-- Initial schema voor de PAVO lead-agent productie-pijplijn.
-- Idempotent: draaibaar tegen een lege DB, of via `supabase db push`.

-- ---------- companies -----------------------------------------------------
create table if not exists companies (
  kvk text primary key,
  naam text not null,
  handelsnaam text,
  website_url text,
  sbi_codes text[] not null default '{}',
  fte_klasse text,  -- "10-19", "20-49", "50-99", "100-199", ">200"
  vestigingsadres text,
  provincie text,
  plaats text,
  lat double precision,
  lng double precision,
  oprichtingsdatum date,
  bestuursvorm text,  -- "bv", "nv", "eenmanszaak", "vof", etc.
  actief boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now()
);

create index if not exists idx_companies_sbi on companies using gin(sbi_codes);
create index if not exists idx_companies_fte on companies(fte_klasse);
create index if not exists idx_companies_provincie on companies(provincie);
create index if not exists idx_companies_geo on companies(lat, lng);

-- ---------- kvk_snapshots -------------------------------------------------
-- Historische diff-logica: bestuurders, FTE, vestigingen. Eén rij per
-- snapshot; upsert gebeurt niet, we appenden.

create table if not exists kvk_snapshots (
  id uuid primary key default gen_random_uuid(),
  kvk text not null references companies(kvk) on delete cascade,
  snapshot_at timestamptz not null default now(),
  raw_data jsonb not null,
  fte_klasse text,
  bestuurders jsonb,  -- array van {naam, functie, sinds}
  vestigingen jsonb,  -- array van vestigingen
  constraint kvk_snapshots_kvk_snapshot_at_unique unique(kvk, snapshot_at)
);

create index if not exists idx_snapshots_kvk on kvk_snapshots(kvk);
create index if not exists idx_snapshots_at on kvk_snapshots(snapshot_at desc);

-- ---------- scrape_runs ---------------------------------------------------
-- Metadata van elke scraper-run per bedrijf. Eén rij per (kvk, scraper,
-- started_at).

create table if not exists scrape_runs (
  id uuid primary key default gen_random_uuid(),
  kvk text not null references companies(kvk) on delete cascade,
  scraper text not null,  -- "01-website", "02-rechtspraak", etc.
  method text,  -- "playwright" | "web_fetch" | "api" — welke route is gebruikt
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  success boolean,
  error text,
  duration_ms integer,
  cost_usd numeric(10, 6),
  input_tokens integer,
  output_tokens integer,
  debug jsonb
);

create index if not exists idx_scrape_runs_kvk on scrape_runs(kvk);
create index if not exists idx_scrape_runs_scraper on scrape_runs(scraper);
create index if not exists idx_scrape_runs_completed on scrape_runs(completed_at desc);
create index if not exists idx_scrape_runs_kvk_scraper_completed
  on scrape_runs(kvk, scraper, completed_at desc);

-- ---------- signals -------------------------------------------------------
-- Per scrape_run alle gedetecteerde signalen. Cluster: integer 1/2/3 of
-- NULL voor "context" (cross-cluster).

create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  scrape_run_id uuid not null references scrape_runs(id) on delete cascade,
  kvk text not null references companies(kvk) on delete cascade,
  categorie text not null,
  cluster integer,
  sterkte integer not null check (sterkte >= 0 and sterkte <= 100),
  confidence integer not null check (confidence >= 0 and confidence <= 100),
  observatie text not null,
  bewijs text[],
  bron_url text,
  bron_type text,  -- "website", "rechtspraak", "nla", etc.
  detected_at timestamptz not null default now()
);

create index if not exists idx_signals_kvk on signals(kvk);
create index if not exists idx_signals_categorie on signals(categorie);
create index if not exists idx_signals_cluster on signals(cluster);
create index if not exists idx_signals_scrape_run on signals(scrape_run_id);

-- ---------- search_queries ------------------------------------------------
-- Wat wanneer door wie gezocht is. Voor observability + kosten-tracking.

create table if not exists search_queries (
  id uuid primary key default gen_random_uuid(),
  filters jsonb not null,
  total_candidates integer,
  total_scraped integer,
  total_leads_returned integer,
  total_cost_usd numeric(10, 4),
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_search_queries_created on search_queries(created_at desc);
