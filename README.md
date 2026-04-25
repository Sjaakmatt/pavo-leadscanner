# PAVO Lead Agent

Next.js app die HR-signalen oplevert per MKB-lead. Draait in twee modes:

- **`demo`** — 44 leads uit `data/leads.json`. Zero config, identiek aan de huidige sales-demo.
- **`prod`** — live pipeline: KvK-afbakening + 6 scrapers via twee externe FactumAI MCPs, classificatie naar PAVO-signalen, scoring + Supabase opslag, dezelfde UI.

Mode-switch zit in `lib/lead-source/index.ts::getLeadSource()` op basis van `process.env.MODE`.

## Snel starten — demo

```bash
cp .env.example .env.local     # alleen ANTHROPIC_API_KEY invullen
npm install
npm run dev
```

## Snel starten — prod

Prod-mode vereist drie externe systemen:

1. **`@factumai/mcp-bedrijven`** op `http://localhost:8110/mcp` — KvK + PDOK
2. **`@factumai/mcp-webscraper`** op `http://localhost:8111/mcp` — 6 scrapers
3. **Supabase** project met de migraties uit `supabase/migrations/`

```bash
# 1. MCPs starten in factumai-mcps repo
cd ../factumai-mcps
pnpm install
pnpm --filter @factumai/mcp-bedrijven dev:http   # 8110
pnpm --filter @factumai/mcp-webscraper dev:http  # 8111

# 2. PAVO-app config
cd ../pavo-leadscanner
cp .env.example .env.local
# vul in: ANTHROPIC_API_KEY, FACTUMAI_MCP_*_URL, FACTUMAI_ORGANIZATION_ID,
# FACTUMAI_AGENT_ID, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY
# zet MODE=prod

npm install
supabase db push                  # applies supabase/migrations/
MODE=prod npm run dev
```

## Architectuur

```
UI → /api/search → getLeadSource()
                   ├── demo → MockLeadSource (data/leads.json)
                   └── prod → ProductionLeadSource
                               ├── BedrijvenMcp (HTTP → :8110)
                               │    ├── kvk_zoeken          (SBI + provincies)
                               │    ├── kvk_basisprofiel    (parallel per kandidaat)
                               │    └── pdok_geocode        (per unieke plaats)
                               ├── Supabase upsert companies
                               ├── Orchestrator (max 5 bedrijven parallel)
                               │    ├── WebscraperMcp (HTTP → :8111)
                               │    │    ├── scrape_website     (Playwright + web_fetch fallback)
                               │    │    ├── scrape_rechtspraak (XML)
                               │    │    ├── scrape_nla         (Playwright + fallback)
                               │    │    ├── scrape_insolventie (Playwright SPA)
                               │    │    ├── scrape_vacatures   (sitemap + JSON-LD)
                               │    │    └── scrape_news        (Google News RSS)
                               │    └── lib/classification (raw → PAVO-Signaal[] via Claude Haiku)
                               ├── Scoring engine (cluster-rules + combinatie-bonussen + diensten-matrix)
                               └── Persist scored_leads + search_queries afronden
```

**Belangrijk**: de MCPs bevatten geen LLM-redenering — ze leveren ruwe HTML/tekst. Classificatie naar PAVO-Signalen leeft uitsluitend in `lib/classification/`. Scoring is pure TS, geen LLM.

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
  mcp/                     # Streamable-HTTP-client + zod-schemas + typed wrappers
  classification/          # PAVO 3-cluster prompt + per-bron classifiers
  orchestrator/            # MCP scrape+classify per bedrijf, batch-runner
  scoring/                 # cluster-regels + combinatie-bonussen + diensten-matrix
  kvk/                     # KvK type-definities + branche→SBI mapping (consumer-side)
  geo/                     # haversine + provincie-centroids (consumer-side)
  supabase/                # server + browser client factories
components/
  Header.tsx + ModeBadge.tsx  # [DEMO]/[PROD] badge (alleen dev)
supabase/
  migrations/
    001_initial_schema.sql       # companies, signals, search_queries, scrape_runs (legacy)
    002_scores_view.sql          # company_scores aggregate view
    003_pavo_mcp_schema.sql      # MCP-only flow: signals.scrape_run_id nullable, scored_leads, status
```

## Tenant-identiteit

`FACTUMAI_ORGANIZATION_ID` + `FACTUMAI_AGENT_ID` worden in iedere MCP tool-call meegestuurd. Het FactumAI-dashboard toont alle PAVO-runs gefilterd op deze IDs — inclusief tokens, kosten en latency per call. Deze metadata staat NIET in `signals` of `scored_leads` (zie MCP_PLATFORM.md §6 over scheiding).

## Bekende gaps / TODOs

- **MCP-contract**: `KvkBasisprofiel.fteKlasse` is optioneel. Wanneer de MCP geen FTE-bucket meegeeft slaat de FTE-filter over. Volg-issue in `factumai-mcps`.
- **Streaming**: `/api/search` retourneert sync. SSE op basis van `search_queries.current_step` staat klaar maar is nog niet bedraad in de UI.
- **Diensten D9-D13**: scoring engine dekt nu D1-D8. PAVO_DIENSTEN in `lib/scoring/types.ts` heeft alle 13 — uitbreiden in `lib/scoring/diensten-matrix.ts` zodra Roy de aanvullende dienstdefinities aanlevert.
