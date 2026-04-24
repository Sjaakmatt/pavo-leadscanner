# PAVO Lead Agent

Next.js app die HR-signalen oplevert per MKB-lead. Draait in twee modes:

- **`demo`** — 44 leads uit `data/leads.json`. Zero config, identiek aan de huidige sales-demo.
- **`prod`** — live pipeline: KvK-afbakening → PDOK geocoding → 6 scrapers parallel → Supabase opslag → scoring engine → dezelfde UI.

De mode-switch zit in `lib/lead-source/index.ts::getLeadSource()` en kijkt naar `process.env.MODE`.

## Snel starten — demo

```bash
cp .env.example .env.local     # alleen ANTHROPIC_API_KEY invullen
npm install
npm run dev
```

## Snel starten — prod

```bash
cp .env.example .env.local
# vul in: ANTHROPIC_API_KEY, KVK_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
# NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
# zet MODE=prod

npm install
npx playwright install chromium   # alleen lokaal nodig
supabase db push                  # applies supabase/migrations/
MODE=prod npm run dev
```

Zonder `KVK_API_KEY` (of met `KVK_API_KEY=placeholder`) draait de KvK-client automatisch in mock-mode — de prod-flow werkt dan end-to-end met deterministische dummy-bedrijven. Handig om te testen voor het abonnement geregeld is.

## Architectuur

```
UI → /api/search → getLeadSource()
                   ├── demo → MockLeadSource (data/leads.json)
                   └── prod → ProductionLeadSource
                               ├── KvK zoeken (SBI + provincies, mock-fallback)
                               ├── KvK basisprofiel (24u cache)
                               ├── PDOK geocoding + haversine filter
                               ├── Supabase upsert companies + snapshot
                               ├── Orchestrator (6 scrapers parallel, max 5 concurrent)
                               │     ├── 01 website      Playwright-first, web_fetch fallback
                               │     ├── 02 rechtspraak  HTTP + XML parsing
                               │     ├── 03 nla          Playwright-first, web_fetch fallback
                               │     ├── 04 insolventie  Playwright-first (SPA), web_fetch fallback
                               │     ├── 06 news         Google News RSS + Claude classificatie
                               │     └── 07 vacatures    Eigen site JSON-LD + werk.nl + NVB + SerpAPI
                               ├── Scoring engine (cluster rules + combinatie-bonussen + diensten-matrix)
                               └── search_queries log
```

## Mappen

```
app/
  api/
    mode/route.ts          # readonly mode-info voor de badge
    search/route.ts        # MODE-switch entrypoint
    lead/[kvk]/route.ts    # MODE-switch per-lead
lib/
  adapters/                # bestaande demo-types + MockLeadSource
  lead-source/             # adapter + ProductionLeadSource
  kvk/                     # KvK client (real + mock) + rate limiter + SBI mapping
  geo/                     # PDOK geocoding + haversine + provincie-centroids
  supabase/                # server + browser client factories
  orchestrator/            # parallel scraper-runner met timeout + persist
  scrapers/                # 6 productie-scrapers (Playwright-first where mogelijk)
  scoring/                 # cluster-regels + combinatie-bonussen + diensten-matrix
components/
  Header.tsx + ModeBadge.tsx  # [DEMO]/[PROD] badge (alleen dev)
supabase/
  migrations/
    001_initial_schema.sql  # companies, kvk_snapshots, scrape_runs, signals, search_queries
    002_scores_view.sql     # company_scores aggregate view
scrapers/                  # bestaande CLI-scrapers (sanity-checks, niet productie)
```

## Kosten-model (productie-run, 50 bedrijven)

Gebaseerd op Haiku 4.5 list-prijzen en Playwright-first architectuur:

| Post | Geschat |
|------|---------|
| KvK (50 × €0,02) | €1,00 |
| Scrapers via Playwright-pad (~$0,005/bedrijf × 4 scrapers) | $1,00 |
| Rechtspraak + News (API + RSS + cls) | $0,25 |
| SerpAPI (optional, 50 queries) | $0,25 |
| Budget-guard cap | $5 |

`MAX_COST_PER_SEARCH_USD` stopt een run zodra het cumulatieve scraper-budget die limiet raakt.

## Productie-scrapers vs CLI-scrapers

- `lib/scrapers/` — productie-library, functie-based, Playwright-first (via `@sparticuz/chromium` op Vercel). Draait vanuit de orchestrator, persist naar Supabase.
- `scrapers/` — standalone CLI-scripts, web_fetch-first, schrijven JSON-rapporten naar `scrapers/output/`. Gebruikt voor dry-run validatie per bron, niet in productie.

## Migratie-workflow

```bash
supabase login
supabase link --project-ref <jouw-project-ref>
supabase db push          # applies de .sql files uit supabase/migrations/
```

Roll-back doe je met `supabase db reset` (lokale dev) of handmatig via SQL editor.

## Bekende gaps / TODOs

- **Diensten D9-D13**: de scoring engine dekt nu D1-D8. Zodra Roy de aanvullende vier dienstdefinities aanlevert: uitbreiden in `lib/scoring/diensten-matrix.ts` (zie de commented-out `DIENSTEN_MATRIX_EXT` block) én de `DienstCode` union in `lib/adapters/types.ts`.
- **Streaming voortgang in prod-mode**: de `/api/search` route retourneert nu nog sync. Voor een echte voortgangsstream moet de orchestrator per-scraper events pushen via SSE. Zie `StreamingStatus.tsx` als interface.
- **Indeed**: scraper 05 draait bewust niet in productie (bewezen niet-werkbaar via Cloudflare/captcha). Houden we als stress-test in `scrapers/`.
