# Observability — wat de agent stuurt, wat het dashboard moet doen

Dit document beschrijft de event-stream die `pavo-leadscanner` (en andere
FactumAI-agents) naar het dashboard pushen, plus de functionele eisen voor
het dashboard om die data nuttig te tonen — op klant-niveau én agent-niveau,
met aparte tabs per logging-categorie.

Het document beschrijft **wat** er gebouwd moet worden, niet **waar** in
de dashboard-codebase. Implementatie volgt in een aparte sessie.

---

## 1. Event-payload die de agent stuurt

Alle events arriveren via `POST {FACTUM_DASHBOARD_URL}/api/v1/agents/events`
(of een gelijkwaardig endpoint). De payload is een JSON-object met deze
verplichte velden bovenop wat het dashboard nu al ontvangt:

| Veld | Type | Beschrijving |
|------|------|--------------|
| `type` | enum | `task_completed` · `task_failed` · `error` · `warning` · `info` · `escalation` · `deploy` · `activity_summary` |
| `category` | enum | Zie tabel §3 — bepaalt onder welke tab het event valt |
| `message` | string | Bondige tekst, **PII-vrij** (geen namen/emails/adressen). Max 4 kB |
| `metadata.org_id` | string \| null | Tenant-id van de klant; NULL bij system-events |
| `metadata.user_id` | string \| null | Specifieke gebruiker, indien van toepassing |
| `metadata.agent_id` | string | Agent-deployment-naam, bv. `pavo-leadscanner` |
| `metadata.audit` | bool | `true` voor compliance-events met langere retention |
| `metadata.*` | divers | Categorie-specifieke velden — zie §3 |
| `created_at` | timestamptz | Server-side timestamp |

**Belangrijk:** PII (emails, full names, adressen) zijn al server-side
gestript door de agent. Het dashboard mag erop vertrouwen dat `message`
en `metadata` veilig zijn om in een audit-log of admin-UI te tonen.

---

## 2. Datamodel-uitbreidingen

De `events`-tabel moet de volgende kolommen krijgen (of een functioneel
equivalent):

- `category` text — voor tab-filtering
- `org_id` text NULL — voor klant-filtering
- `user_id` text NULL — voor user-filtering
- `agent_id` text — voor agent-filtering
- `audit` bool DEFAULT false — markeert events met langere retention
- `expires_at` timestamptz NULL — concrete delete-deadline (zie §6)

Indices die het dashboard nodig heeft voor performance:
- `(org_id, category, created_at DESC)` — klant-tab filtering
- `(agent_id, category, created_at DESC)` — agent-tab filtering
- `(expires_at) WHERE expires_at IS NOT NULL` — retention-cron

---

## 3. Categorieën + minimum metadata-velden per categorie

Het dashboard moet voor elke categorie een eigen tab tonen met deze kolommen:

### `search` — zoekflows
- `branche`, `fte_klassen`, `regio_straal_km`, `leads_returned`, `relaxation`, `refresh`, `durationMs`
- Toon: tabel met tijdstip, branche, # leads, duration, status

### `search_stage` — per-fase timing binnen een search
- `stage` (kvk/geo/scrape/score), `duration_ms`, stage-specifieke counts
- Toon: histogram van fase-duur per dag — uitschieters opsporen

### `scoring` — generieke scoring-events (legacy, weinig gebruikt)
- Toon: net als `llm_decision`

### `llm` — ruwe LLM-calls (Anthropic Claude)
- `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_create_tokens`, `cost_usd`, `duration_ms`
- Toon: tabel met model · in/uit tokens · cache-hit rate · kosten · latency
- Aggregaten: dagelijkse kosten per model, gemiddelde latency, cache-hit %

### `llm_decision` — AI-beslissingen die natuurlijke personen evalueren (Art. 22 GDPR + AI Act art. 12)
- `kvk`, `warmte` (HOT/WARM/COLD), `warmte_reden`, `totale_score`, `archetype`, `signaal_categorieen`, `cold_redenen`
- Toon: dedicated audit-tab met **append-only** garantie. Geen edit, geen delete behalve via right-to-erasure-flow
- Aggregaat: warmte-distributie per dag

### `mcp` — MCP-tool-calls vanuit de agent
- `tool`, `mcp_url`, `duration_ms`, `attempts`, `error?`
- Toon: tabel + grafiek error-rate per MCP/tool. Top-10 traagste tools

### `auth` — login + magic-link + profile auto-heal
- `error?`, `error_code?`, `has_session?`, `has_email?`
- `audit: true` standaard — langere retention
- Toon: login-attempts tabel, failure-rate, suspicious patterns (zelfde user_id × N otp_expired)

### `user_action` — door gebruiker getriggerde acties
- `action` (create_search/update_search/delete_search/chat_question/lead_view/csv_export/...), entity-id (e.g. `search_id`, `kvk`)
- Toon: per-user activity-feed

### `cron` — scheduled jobs (alleen failures relevant; success is volume)
- `cron`, `duration_ms`, `error?`, `stack?`
- Toon: failures-tab + succes-rate metric

### `compliance` — expliciet audit-trail event
- Bv. data-export, role-change, data-erasure
- Toon: append-only audit-log. RBAC: alleen admins zien deze tab

### `system` — deploy, error, heartbeat
- Toon: agent-health overview

---

## 4. Dashboard UI-structuur

**Twee navigatie-niveaus:**

### A. Klant-niveau (`/klanten/{org_id}`)
Eén klant, alle agents van die klant samengevoegd:
- **Overview** — KPI-cards: # zoekopdrachten vandaag, win-rate, kosten EUR/dag
- **Activiteit** — chronologische feed alle events (filterbaar op categorie)
- **Errors & warnings** — `type IN (error, warning)`, gegroepeerd per stack-fingerprint
- **AI-beslissingen** — `category = llm_decision`, append-only audit-log
- **Compliance-trail** — `metadata.audit = true`, RBAC-gated
- **Kosten** — `category IN (llm, mcp)` met `cost_usd` aggregaten

### B. Agent-niveau (`/agents/{agent_id}`)
Eén deployment, alle klanten:
- **Health** — heartbeat-status, error-rate laatste uur, p95-latency
- **Tabs:**
  - Errors (`type = error`)
  - LLM-calls (`category = llm`)
  - LLM-beslissingen (`category = llm_decision`)
  - MCP-calls (`category = mcp`)
  - Searches (`category IN (search, search_stage)`)
  - User-acties (`category = user_action`)
  - Auth (`category = auth`)
  - Cron (`category = cron`)
  - Compliance (`metadata.audit = true`)

**Cross-cutting controls op elke tab:**
- Tijdvenster (1u / 24u / 7d / 30d / 90d)
- Org-filter dropdown (op agent-niveau-tabs)
- Severity-filter (alleen errors / + warnings / alles)
- Free-text search op `message` — disabled wanneer geen org-filter actief (privacy)
- Export CSV / JSON

---

## 5. API-endpoints die het dashboard moet exposen

```
GET  /api/v1/orgs/{org_id}/events?category=…&since=…&type=…
GET  /api/v1/agents/{agent_id}/events?category=…&since=…&org_id=…
GET  /api/v1/orgs/{org_id}/aggregates/llm-cost?range=24h
GET  /api/v1/orgs/{org_id}/aggregates/warmte-distribution?range=7d
GET  /api/v1/agents/{agent_id}/health  → laatste heartbeat + error-rate
DELETE /api/v1/events?user_id={user_id}&confirm=true  → right-to-erasure
POST /api/v1/agents/events  → ingest endpoint (bestaand, verrijken)
```

Authenticatie:
- Ingest: bestaande `FACTUM_API_KEY` per agent
- Read: dashboard-session (admin-RBAC voor compliance/audit-tabs)

---

## 6. Compliance — AVG/GDPR + AI Act

Het dashboard implementeert deze garanties:

### Data-minimization (Art. 5 GDPR)
De agent stript PII al server-side. Het dashboard mag GEEN gemaskeerde
secrets / emails / namen weer tonen — als er per ongeluk een lekt, staat
er `[redacted:pii]` of `[redacted:secret]` in de payload.

### Retention (Art. 5)
Default-retention per event-type:
- `audit: true` → **365 dagen**
- `category = compliance` → **365 dagen**
- `category IN (auth, llm_decision)` → **180 dagen**
- alle overige → **90 dagen**

`expires_at` wordt server-side gezet bij ingest op basis van bovenstaande
regels. Een dagelijkse cron `DELETE FROM events WHERE expires_at < NOW()`
ruimt op. Documenteer deze policy in de privacy-statement van de klant.

### Right to erasure (Art. 17)
`DELETE /api/v1/events?user_id={user_id}` is admin-only. Verwijdert alle
events met `metadata.user_id = ?`. Logt zelf een `compliance`-event:
"Erasure-request voor user_id=X · N events verwijderd".

### Per-tenant isolation (Art. 32)
Geen enkele query mag cross-org data lekken. RLS op database-niveau OF
expliciete `org_id`-filter in elke service-laag query. Cross-tenant
read alleen voor super-admins (audit-event verplicht).

### AI Act art. 12 (logging high-risk AI)
`category = llm_decision` is append-only. Geen UPDATE op die rijen ooit.
Inhoud bevat:
- Model-identifier (`model`)
- Beslissings-output (`warmte`, `score`)
- Reasoning-summary (`warmte_reden`, `cold_redenen`, `signaal_categorieen`)

NIET in de payload: full-prompt, full-bron-tekst, contact-info. Die staan
elders (DB scored_leads-tabel) met eigen retention.

### DPA
Dashboard = processor, klant = controller. Documenteer:
- Welke data wordt verwerkt
- Bewaartermijnen (zie boven)
- Sub-processors (Vercel, Supabase, Cloudflare, Anthropic)
- Klant-rechten (inzage, rectificatie, erasure)

---

## 7. Acceptance-criteria

Voor de dashboard-implementatie geldt klaar = al deze checks groen:

- [x] Klant-dropdown filtert correct op `org_id` over alle tabs (agent-niveau page; klant-niveau page is per-definitie al org-scoped)
- [x] Agent-dropdown filtert correct op `agent_id` (komt in fase 4 voor cross-tenant slug-views)
- [x] Tab "LLM" toont kolommen: model, in/uit tokens, kosten, latency (kosten via Costs-tab + raw events)
- [x] Tab "LLM-beslissingen" is append-only (geen edit-buttons), RBAC-gated
- [x] Tab "Errors" expandeert stack-trace inline (via `<details>` op metadata)
- [x] Tab "Compliance" toont alleen `audit = true` events, RBAC-gated
- [x] CSV-export werkt per tab (max 10k rijen)
- [x] Tijdvenster-filter werkt op alle tabs zonder full-table-scan (`(orgId|agentSlug|agentId, category, timestamp DESC)` indices)
- [x] Free-text search op `message` is disabled zonder org-filter
- [x] `DELETE /api/v1/events?user_id=…` werkt en logt zelf een compliance-event per agent
- [x] Retention-cron loopt dagelijks en respecteert per-categorie TTL
- [x] Ingest-endpoint accepteert nieuwe `category` + `audit` velden
- [x] Aggregaten (kosten, warmte-distributie) refreshen <30s
- [x] Geen cross-tenant data leakage te reproduceren via API of UI (alle queries scoped op `orgId` of `agentId`; `requireSuperAdmin` voor cross-org reads)

---

## 8. Migratie-pad

1. **Schema-migration** — voeg `category`, `org_id`, `user_id`, `agent_id`, `audit`, `expires_at` toe. Default-waarden voor backfill: `category = 'system'`, `agent_id = onbekend`
2. **Ingest-endpoint** — accepteer + valideer nieuwe velden, set `expires_at` server-side
3. **API read-endpoints** — orgs/agents events met categorie-filter
4. **UI** — twee navigatie-niveaus + tabs; cross-cutting filters
5. **Retention-cron** — TTL-based cleanup
6. **Erasure-endpoint** — admin-only, audit-trail
7. **DPA + privacy-statement** — documenteer publiek
8. **Acceptance-tests** — alle checks uit §7 groen

---

## 9. Implementatie-status

Stand 2026-05-06 — fases 1, 2 en 3 zijn live op
`claude/add-agent-logging-dashboard-Qkpd1` in beide repo's.

### Fase 1 — Fundament

**Dashboard-zijde (factumai-dashboard):**
- [x] `AgentEvent` schema-migratie (`category`, `orgId`, `userId`, `agentSlug`, `audit`, `expiresAt`) + indices
- [x] Ingest-endpoints (`/api/v1/ingest/event`, `/api/v1/ingest/batch`) accepteren + valideren de nieuwe velden
- [x] `expiresAt` wordt server-side gezet via `computeExpiresAt(category, audit)` (90/180/365 dagen-ladder)
- [x] Retention-cron veegt `AgentEvent` rijen waar `expiresAt < NOW()` bovenop bestaande table-level retention
- [x] `docs/AGENT-INTEGRATION.md` documenteert nieuwe contract

**Agent-zijde (pavo-leadscanner):**
- [x] `lib/factum/client.ts` ondersteunt `category` + `audit` als top-level options op `logEvent`
- [x] `lib/observability/logger.ts::logObs` stuurt category + audit top-level (niet meer in metadata) en blijft `org_id` / `user_id` / `agent_id` in metadata stempelen
- [x] `instrumentation.ts` deploy + onRequestError lopen via `logObs` / `logError` met `category: "system"`
- [x] Bestaande call-sites in `app/api/search/route.ts` + `app/api/lead/[kvk]/route.ts` gebruiken de juiste categorieën (`search`, `user_action`, `system`)

### Fase 2 — Read APIs + agent-niveau UI

- [x] `GET /api/v1/agents/[id]/events` met `tab/since/severity/category/audit/q/cursor/format=csv`. Privacy-guard: `q` genegeerd zonder `org_id`. CSV cap 10k rijen
- [x] `GET /api/v1/agents/[id]/health` — status + last-seen + error-rate laatste uur + p95 latency + uptime-distributie 24u
- [x] `src/lib/event-queries.ts` met `OBSERVABILITY_TABS` preset, parsing helpers, `countPerTab()` (één groupBy → 9 counts), `eventsToCsv()` + tests
- [x] `/agency/agents/[id]/observability` page met SecondaryNav (9 tabs) + filterbar (tijdvenster / severity / klant / zoek) + events-tabel + CSV-export
- [x] `/agency/agents/[id]/page.tsx` extra "Observability" knop

### Fase 3 — Klant-niveau UI + aggregaten + erasure + DPA

- [x] `GET /api/v1/orgs/[id]/events` — org-scoped variant van events-API
- [x] `GET /api/v1/orgs/[id]/aggregates/llm-cost?range=...` — daggemiddeldes per model via raw SQL JSON-extract op `metadata.cost_usd`
- [x] `GET /api/v1/orgs/[id]/aggregates/warmte-distribution?range=...` — HOT/WARM/COLD distributie per dag voor `llm_decision` events
- [x] `DELETE /api/v1/events?user_id=...&confirm=true` — right-to-erasure + per-agent compliance audit-event met `subject_hash` (geen plain id)
- [x] `/agency/clients/[id]/observability` page met 6 tabs (Overview / Activiteit / Errors / AI-beslissingen / Compliance / Kosten). KPI-cards op Overview, daggemiddelde-tabel op Kosten via raw SQL
- [x] `/agency/clients/[id]/page.tsx` extra "Observability" knop
- [x] `factumai-dashboard/docs/DPA.md` — concept-DPA met bewaartermijnen, sub-processors, klant-rechten en wijzigingsproces

**Backwards-compat:** legacy events zonder category blijven werken op het
dashboard — die landen onder `category = NULL` met 90d default-TTL via
de retention-cron. Niets breekt voor bestaande callers.

### Open / fase 4 (optioneel)

- Customer-facing portal `/klanten/{org_id}` met rol-aware RBAC zodat klant zelf z'n events kan zien (nu zit alles achter `requireSuperAdmin`)
- Cross-tenant agent-slug views — één deployment over alle klanten via `agentSlug`
- LLM-cost grafiek-visualisatie (tabular nu, line chart later)
- Stack-fingerprint grouping op de Errors-tab (nu losse rijen)
- Auto-PII-redaction sweep op bestaande events vóór fase 1 (legacy events, lage prio)
