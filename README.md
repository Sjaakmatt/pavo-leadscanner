# PAVO Lead Agent

Next.js app die HR-signalen oplevert per MKB-lead. Draait in twee modes:

- **`demo`** — 44 leads uit `data/leads.json`. Zero config, identiek aan de huidige sales-demo.
- **`prod`** — live pipeline: KvK-afbakening + scrapers via vier externe FactumAI domein-MCPs (bedrijven + vacatures + juridisch + news), classificatie naar PAVO-signalen, scoring + Supabase opslag, dezelfde UI.

Mode-switch zit in `lib/lead-source/index.ts::getLeadSource()` op basis van `process.env.MODE`.

## Snel starten — demo

```bash
cp .env.example .env.local     # alleen ANTHROPIC_API_KEY invullen
npm install
npm run dev
```

## Snel starten — prod

Prod-mode vereist twee externe systemen:

1. **Vier FactumAI domein-MCPs** (allemaal Streamable HTTP):
   - `@factumai/mcp-bedrijven` op `http://localhost:8110/mcp` — KvK + PDOK + `get_company_website_content`
   - `@factumai/mcp-vacatures` op `http://localhost:8120/mcp` — `extract_vacancies_from_company_site`
   - `@factumai/mcp-news`      op `http://localhost:8121/mcp` — `search_company_news`
   - `@factumai/mcp-juridisch` op `http://localhost:8122/mcp` — `search_court_cases` + NLA/insolventie stubs
2. **Supabase** project met de migraties uit `supabase/migrations/`

```bash
# 1. MCPs starten in factumai-mcps repo
cd ../factumai-mcps
pnpm install
pnpm --filter @factumai/mcp-bedrijven dev:http   # 8110
pnpm --filter @factumai/mcp-vacatures dev:http   # 8120
pnpm --filter @factumai/mcp-news      dev:http   # 8121
pnpm --filter @factumai/mcp-juridisch dev:http   # 8122

# 2. PAVO-app config
cd ../pavo-leadscanner
cp .env.example .env.local
# vul in: ANTHROPIC_API_KEY, FACTUMAI_MCP_*_URL (4 stuks),
# FACTUMAI_ORGANIZATION_ID, FACTUMAI_AGENT_ID, NEXT_PUBLIC_SUPABASE_URL,
# NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
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
                               │    ├── kvk_zoeken                    (één call met woonplaatsen binnen radius)
                               │    ├── kvk_basisprofiel              (parallel per kandidaat)
                               │    ├── pdok_geocode                  (per unieke plaats)
                               │    └── get_company_website_content   (Playwright + web_fetch)
                               ├── Supabase upsert companies
                               ├── Orchestrator (max 5 bedrijven parallel)
                               │    ├── BedrijvenMcp.get_company_website_content
                               │    ├── VacaturesMcp (HTTP → :8120)
                               │    │    └── extract_vacancies_from_company_site (sitemap + JSON-LD + ATS)
                               │    ├── JuridischMcp (HTTP → :8122)
                               │    │    ├── search_court_cases       (Rechtspraak XML)
                               │    │    ├── search_labor_inspections (NLA — stub)
                               │    │    └── search_insolvencies      (insolventieregister — stub)
                               │    ├── NewsMcp (HTTP → :8121)
                               │    │    └── search_company_news      (Google News RSS)
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
  factum/                  # FactumAI dashboard client (heartbeat + events + metrics)
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
instrumentation.ts            # Next.js startup hook → factum.connect()
supabase/
  migrations/
    001_initial_schema.sql       # companies, signals, search_queries, scrape_runs (legacy)
    002_scores_view.sql          # company_scores aggregate view
    003_pavo_mcp_schema.sql      # MCP-only flow: signals.scrape_run_id nullable, scored_leads, status
```

## Tenant-identiteit

`FACTUMAI_ORGANIZATION_ID` + `FACTUMAI_AGENT_ID` worden in iedere MCP tool-call meegestuurd. Het FactumAI-dashboard toont alle PAVO-runs gefilterd op deze IDs — inclusief tokens, kosten en latency per call. Deze metadata staat NIET in `signals` of `scored_leads` (zie MCP_PLATFORM.md §6 over scheiding).

## Dashboard logging (FactumAI)

Naast de tool-call logs vanuit de MCPs streamt de leadscanner zelf óók
agent-status, search-events en daily ROI-metrics naar het FactumAI-
dashboard. Daardoor verschijnen runs live in de event-feed met de
agent als "online", inclusief duur, aantal opgeleverde leads en
geschatte tijdsbesparing.

**Wat wordt gelogd:**

| Trigger                            | Endpoint                       | Type                           |
|------------------------------------|--------------------------------|--------------------------------|
| App start                          | `/api/v1/agent/connect`        | online + heartbeat-loop start  |
| Iedere 60s (long-running runtime)  | `/api/v1/ingest/heartbeat`     | online ping                    |
| Iedere 5 min (Vercel cron)         | `/api/v1/ingest/batch`         | heartbeat + dagcijfers         |
| `POST /api/search` slaagt          | `/api/v1/ingest/event`         | `task_completed`               |
| `POST /api/search` faalt           | `/api/v1/ingest/event`         | `task_failed`                  |
| `POST /api/search` (na succes)     | `/api/v1/ingest/metrics`       | tasksCompleted + tijd-bespaard |
| `GET /api/lead/[kvk]` (hit)        | `/api/v1/ingest/event`         | `info`                         |
| `GET /api/lead/[kvk]` (404)        | `/api/v1/ingest/event`         | `warning`                      |
| `GET /api/lead/[kvk]` (exception)  | `/api/v1/ingest/event`         | `error`                        |
| SIGTERM / SIGINT                   | `/api/v1/agent/disconnect`     | offline                        |

**Vercel cron — heartbeat + dagcijfers (elke 5 min):** op Vercel-serverless
overleeft de 60s setInterval-heartbeat geen lambda-cycle. `vercel.json`
schedulet daarom `/api/cron/factum-sync` op `*/5 * * * *`. De route
aggregateert vandaag's `search_queries`-totalen (completed/failed,
gem. duur, opgeleverde leads → tijdsbesparing) en stuurt die in één
batch-POST naar `/api/v1/ingest/batch` samen met een `online` heartbeat.
Zo blijft de agent in het dashboard "online" én up-to-date ook tussen
searches door. Implementatie staat in `app/api/cron/factum-sync/route.ts`
+ `lib/factum/metrics-aggregator.ts`. Bescherm de route in productie
met `CRON_SECRET` (Vercel zet de header automatisch).

**Configureren:**

1. Maak een API key aan via Agency Dashboard → Clients → [Client] → Agent → Integrate.
2. Vul `FACTUM_DASHBOARD_URL` en `FACTUM_API_KEY` in `.env.local`.
3. Klaar — `instrumentation.ts` registreert de agent automatisch bij de
   eerste request, daarna stuurt iedere search een event.

Beide env-vars leeg = logging staat uit en de leadscanner draait
stand-alone (dus demo blijft echt zero-config). Implementatie zit in
`lib/factum/client.ts`; spec staat in `factumai-dashboard/docs/AGENT-INTEGRATION.md`.

## Bekende gaps / TODOs

- **MCP-contract**: `KvkBasisprofiel.fteKlasse` is optioneel. Wanneer de MCP geen FTE-bucket meegeeft slaat de FTE-filter over. Volg-issue in `factumai-mcps`.
- **Streaming**: `/api/search` retourneert sync. SSE op basis van `search_queries.current_step` staat klaar maar is nog niet bedraad in de UI.
- **Diensten D9-D13**: scoring engine dekt nu D1-D8. PAVO_DIENSTEN in `lib/scoring/types.ts` heeft alle 13 — uitbreiden in `lib/scoring/diensten-matrix.ts` zodra Roy de aanvullende dienstdefinities aanlevert.
- **Daily metrics overschrijven**: het ingest endpoint `pushMetrics` upsert per datum. Iedere search overschrijft nu de teller — voor accurate dag-aggregatie willen we dit op termijn vervangen door een cron-route die uit `search_queries` aggregateert.
