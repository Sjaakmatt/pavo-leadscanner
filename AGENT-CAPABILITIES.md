# PAVO LeadScanner — Agent Capabilities

> Volledige beschrijving van wat de agent kan, welke databronnen worden gebruikt
> en hoe de scoring tot stand komt. Dit document is bedoeld als basis voor
> een Standard Operating Procedure (SOP) voor sales en operations.

**Versie:** 1.0
**Laatst bijgewerkt:** mei 2026

---

## Inhoudsopgave

1. [Wat doet de agent?](#1-wat-doet-de-agent)
2. [Twee modi: search vs chat](#2-twee-modi-search-vs-chat)
3. [Databronnen](#3-databronnen)
4. [Hoe wordt een lead gescoord?](#4-hoe-wordt-een-lead-gescoord)
5. [Diensten-matching](#5-diensten-matching)
6. [Hard-uitsluiters](#6-hard-uitsluiters)
7. [Kosten per zoekopdracht](#7-kosten-per-zoekopdracht)
8. [Privacy, AVG en AI Act](#8-privacy-avg-en-ai-act)
9. [Wat de agent NIET doet](#9-wat-de-agent-niet-doet)
10. [Begrippenlijst](#10-begrippenlijst)

---

## 1. Wat doet de agent?

PAVO LeadScanner is een AI-agent die HR-leads vindt + scoort voor PAVO's
verkoop-team. De agent:

1. **Zoekt** bedrijven via filters (branche, omvang, regio) in de KvK
2. **Verrijkt** elk bedrijf met publieke signalen (vacatures, juridisch,
   inspecties, faillissementen, news, branche-context)
3. **Scoort** elk bedrijf op warmte (HOT / WARM / COLD) en op aansluiting
   met PAVO's diensten
4. **Toont** sales een prioriteit-lijst met onderbouwing per lead
5. **Beantwoordt** vragen via een chat-agent op de lead-detail-pagina

De agent vervangt geen sales-medewerker — het levert kandidaten + context.
Eind­beslissing (bellen, bezoeken, niet contacten) blijft mens.

---

## 2. Twee modi: search vs chat

### Search-modus (de zoekopdracht)

**Trigger:** sales vult filters in en klikt "Zoek leads"
**Wat gebeurt er:**

```
Filter (branche + omvang + regio)
  → KvK Zoeken v2 (bedrijven in regio binnen filters)
  → KvK Basisprofiel v1 (per bedrijf: SBI, FTE, bestuurders, website)
  → Geo-filter (haversine binnen straal)
  → Per bedrijf parallel scrapen:
       Vacatures (Recruitee/Greenhouse/Lever/Personio/sitemap)
       Rechtspraak (arbeidsrechtelijke uitspraken)
       NLA-arbeidsinspectie (overtredingen WAV/WML/Arbo/ATW)
       Insolventieregister (faillissement/surseance/wsnp)
       News (Google News reorganisaties)
       Website-content (signalen, headcount, reorganisatie-aankondigingen)
  → Anthropic Claude Haiku 4.5 classificeert ruwe data → signalen
  → Scoring-engine berekent warmte + dienstmatch + archetype
  → Lead-lijst gesorteerd op warmte
```

**Output:** een gerangschikte lead-lijst met per lead:
- Warmte (HOT / WARM / COLD) + reden
- Top diensten-match (welke PAVO-diensten passen bij dit bedrijf)
- Signaal-lijst (wat hebben we gevonden?)
- Archetype (bv. "groei-knelpunt", "bouw-snelheidsbedrijf", "verzuim-issue")

**Doorlooptijd:** typisch 30-90 seconden voor 50-100 bedrijven (met cache).
Eerste run zonder cache 2-4 minuten.

### Chat-modus (de lead-detail-agent)

**Trigger:** sales klikt "Vraag de agent" op een lead-detail-pagina
**Wat kan de agent doen:**

| Tool | Doel | Voorbeelden van vragen |
|------|------|------------------------|
| `get_kvk_basisprofiel` | Verse KvK-snapshot (€0,02) | *"Hoeveel werknemers nu?"* / *"Welke vestigingen?"* |
| `get_kvk_snapshot_history` | Trends over tijd (gratis) | *"Is FTE gegroeid?"* / *"Wanneer wisselden bestuurders?"* |
| `scrape_vacancies` | Live vacature-lijst (gratis) | *"Welke openstaande vacatures nu?"* |
| `search_court_cases` | Rechtspraak-uitspraken (gratis) | *"Heeft dit bedrijf arbeidsrechtelijke geschillen?"* |
| `search_labor_inspections` | NLA-overtredingen (gratis) | *"Heeft dit bedrijf NLA-boetes gehad?"* |
| `search_insolvencies` | Centraal Insolventieregister (gratis) | *"Is er een gerelateerd faillissement?"* |
| `search_news` | Google News (gratis) | *"Recent overgenomen?"* / *"Reorganisatie aangekondigd?"* |
| `get_cbs_branche_context` | CBS branche/regio cijfers (gratis) | *"Hoe staat de sector ervoor?"* |
| `get_lead_signals_raw` | Onderliggende signaaldata (gratis) | *"Wat is het exacte bewijs voor signaal X?"* |

Per chat-sessie geldt een **per-tool budget** (typisch 2 calls) zodat de
agent zichzelf niet in een loop kan praten en kosten beheersbaar blijven.

---

## 3. Databronnen

### 3.1 Primaire bedrijfsdata

#### Kamer van Koophandel (KvK Handelsregister)
- **API's:** Zoeken v2 (gratis) + Basisprofiel v1 (€0,02 per call)
- **Wat:** Officiële bedrijfsregistratie — naam, KvK-nummer, SBI, vestigingen,
  bestuurders, FTE-klasse, oprichtingsdatum, website
- **Cache:** 7 dagen voor basisprofielen (refresh-cron updates HOT/WARM-leads
  dagelijks)
- **Beperkingen:** Zoeken v2 ondersteunt geen SBI- of provincie-filters.
  We zoeken daarom plaats-voor-plaats binnen de straal en filteren SBI
  + FTE client-side.

### 3.2 HR-signaal bronnen

#### Vacatures (mcp-vacatures)
- **Adapters:** Recruitee, Greenhouse, Lever, Personio, generic site-scraping
  (sitemap + JSON-LD + meta-tags)
- **Wat:** Live openstaande vacatures + historie via 3-staps fallback
  (careers-API → board-API → HTML scrape)
- **Detectie:** herposte vacatures (zelfde titel ≥2x = wervingspijn),
  langlopende vacatures (45+ dagen open), volume per FTE-klasse

#### Rechtspraak (mcp-juridisch)
- **API:** data.rechtspraak.nl Atom-feed, sort=DESC, 36-maand window
- **Wat:** Uitspraken in arbeidsrecht, ambtenarenrecht, sociaal recht
- **Filtering:**
  - Naam moet letterlijk in titel/inhoud voorkomen (anonimisering treft
    rechtspersonen niet)
  - Strict rechtsgebied-filter (geen BPM, vreemdelingenrecht, etc.)
  - Pseudonimiseringsfilter (VOF/eenmanszaak/maatschap → skip)

#### NLA Arbeidsinspectie (mcp-juridisch)
- **API:** `resultaten.nlarbeidsinspectie.nl/api/inspecties`
- **Wat:** Vastgestelde overtredingen op:
  - WAV (Tewerkstelling vreemdelingen / illegaal personeel)
  - WML (Loonbetaling / minimumloon)
  - Arbeidstijdenwet (te lang werken)
  - Arbobesluit (RIE, preventiemedewerker, valgevaar, etc.)
- **Filtering:** alleen `Resultaat = "Overtreding vastgesteld"` (clean
  inspecties leveren geen signaal)
- **Dedupe:** binnen één inspectie op type (NLA splitst soms één
  overtreding per werknemer)

#### Centraal Insolventieregister (mcp-juridisch)
- **API:** `insolventies.rechtspraak.nl/Services/WebInsolventieService/zoekOpRechtspersoon`
- **Wat:** Faillissement, surseance van betaling, WSNP (schuldsanering)
- **Implementatie:** ASP.NET MVC anti-forgery flow met session-cache
  (30 min TTL, retry-once bij 401/403)
- **Filtering:** alleen rechtspersonen (B.V./N.V./Stichting/V.O.F./etc.)
- **Type-extractie:** uit publicatiekenmerk-letter (.F. = faillissement,
  .R. = WSNP, .S. = surseance) of uit omschrijving

#### News (mcp-news)
- **Bron:** Google News RSS
- **Wat:** Recente artikelen, persberichten, overnames, reorganisatie-
  aankondigingen
- **Bijzonder:** Google News tracker-URL decoder (klikbare directe links
  i.p.v. tracker-redirects)

### 3.3 Branche- en regio-context

#### CBS Open Data (geen aparte MCP — `lib/cbs/`)
Vijf datasets:

| Dataset | Wat | Granulariteit |
|---------|-----|---------------|
| **80072NED** | Ziekteverzuim per branche | Per kwartaal, per SBI-sectie + landelijk |
| **80590NED** | Spanningsindicator (krapte arbeidsmarkt) | Per kwartaal, per arbeidsmarktregio (35 regio's) |
| **82800NED** | Vacaturegraad | Per kwartaal, per branche + landelijk |
| **84244NED** | Faillissementen per maand | Per branche, met YoY-trend |
| **84498NED** | Cao-loonontwikkeling | Per maand, YoY |

**Cache:** 7 dagen (CBS data verandert kwartaal/maand)
**Mapping:**
- SBI → CBS-bedrijfstak op SBI-sectieletter (A-U) niveau
- Provincie → CBS-arbeidsmarktregio (centrale stad per provincie)

---

## 4. Hoe wordt een lead gescoord?

### 4.1 Signaal-clusters

Elk signaal valt in één van drie clusters:

| Cluster | Wat | Voorbeelden |
|---------|-----|-------------|
| **Cluster 1: Compliance + risico** | Boetes, sancties, juridische risico's | NLA-overtreding, arbeidsinspectie-stillegging, asbest-overtreding, arbeidsrechtzaak-patroon |
| **Cluster 2: Groeipijn + verloop** | Volume- en wervingsdruk | herposte_vacatures, langlopende_vacatures, hoog_verloop, vacatures_volume |
| **Cluster 3: Verandering + reorganisatie** | Strategische wijzigingen | overname, reorganisatie, bestuurderswissel, fte_verandering |

### 4.2 Cluster-gewichten (sterkste signalen)

| Categorie | Cluster | Punten |
|-----------|---------|--------|
| `arbeidsinspectie_stillegging` | 1 | 40 |
| `arbo_boete_recent` | 1 | 35 |
| `arbeidsrechtzaak_patroon` | 1 | 30 |
| `asbest_overtreding` | 1 | 25 |
| `herposte_vacatures` | 2 | 25-100 (schaalt met aantal) |
| `langlopende_vacatures` | 2 | tot 100 (schaalt met dagen) |
| `failliet_of_surseance` | hard-uitsluiter | forceert COLD |

### 4.3 Warmte-bepaling

```
HOT  = cluster1 ≥ 50 punten OF (cluster1 ≥ 30 EN cluster2 ≥ 30)
WARM = cluster1 ≥ 30 OF cluster2 ≥ 30 OF cluster3 ≥ 30
COLD = anders
```

Plus override-regels (bv. "vacatures + groeisignaal = direct HOT" of
"draaideur-bestuurders + ontslagzaak = HOT").

### 4.4 Scoring-rationale

Elke lead krijgt:
- **Warmte** (HOT/WARM/COLD)
- **Warmte_reden** (kort waarom)
- **Totale_score** (0-100)
- **Cold_redenen** (alleen voor COLD: waarom geen signaal)
- **Diensten_match** (zie §5)
- **Archetype** (bv. "verzuim-issue", "groei-knelpunt")
- **Samenvatting** (1-2 zinnen voor sales)

---

## 5. Diensten-matching

PAVO heeft een aantal diensten. Per signaal-categorie wegen we welke
diensten het beste aansluiten:

| Dienst | Sterkste signaal-matches |
|--------|--------------------------|
| **D4 — Hulp bij verzuim** | arbeidsinspectie_stillegging (35), arbo_boete_recent (30) |
| **D5 — Hulp regelgeving** | arbeidsinspectie_stillegging (45), arbo_boete_recent (40), asbest_overtreding (30) |
| **D11 — Verzuimreglement** | arbo_boete_recent (30), arbeidsinspectie_stillegging (30) |
| **D12 — RI&E** | arbeidsinspectie_stillegging (45), arbo_boete_recent (40), asbest_overtreding (35) |

Plus diensten voor groei (D1/D2 — werving), verandering (D7/D8 —
reorganisatie), en cao (D9 — beloning).

Per lead worden de top-3 best matchende diensten getoond.

---

## 6. Hard-uitsluiters

Bepaalde signalen forceren een COLD-uitkomst, ongeacht andere scores:

- **`failliet_of_surseance`** — bedrijf is failliet of in surseance.
  Forceert COLD met `minScore=0` en reden *"Actief faillissement of
  surseance — uitgesloten als lead"*. Geen recency-decay (het blijft
  COLD totdat status wijzigt).
- **KvK-status `actief: false`** — bedrijf is uitgeschreven uit het
  Handelsregister. Geen lead.
- **Pseudonimiseringsnamen** — VOF/eenmanszaak/maatschap zoekt rechtspraak
  überhaupt niet uit, want anonimisering geeft toch geen hits.

---

## 7. Kosten per zoekopdracht

Gemiddelde search van 50 bedrijven kost ongeveer:

| Bron | Kosten |
|------|--------|
| KvK Basisprofiel | €0,02 × ~30 cache-misses = €0,60 |
| Anthropic Claude Haiku 4.5 | ~€0,03 voor 200 classifier-calls (met prompt-cache) |
| Vacatures + News + Juridisch + NLA + Insolventie + CBS | gratis |
| **Totaal** | **~€0,65 per search** |

Dagelijkse cap configureerbaar via `ORG_DAILY_SEARCH_CAP` env (default 50).
Per-search hard-cap voor classifier-budget: €10.

Real-time cost-tracker zichtbaar in `/admin/searches` (alleen admins).

---

## 8. Privacy, AVG en AI Act

### Datagebruik
- **B2B-data:** KvK is publiek register. Bedrijfsdata mag worden verwerkt.
- **PII-stripping:** alle event-logging strippt automatisch e-mails, namen,
  adressen, secrets (regex-based redactie).
- **Lead-context** (bedrijfsnaam, KvK, signalen) blijft binnen Supabase
  van de klant — niet gedeeld met andere klanten (RLS-isolated).

### Retention-policies
| Type | Bewaartermijn |
|------|---------------|
| Audit-events (auth, status-change, exports) | 365 dagen |
| AI-beslissingen (`llm_decision`) | 180 dagen |
| Auth-events | 180 dagen |
| Generieke events | 90 dagen |

### AI Act art. 12 (logging high-risk AI)
Elke scoring-beslissing wordt gelogd als `category=llm_decision` met:
- Model-identifier
- Beslissings-output (warmte, score)
- Reasoning-summary (warmte_reden, signaal_categorieen, cold_redenen)

Append-only: deze logs mogen nooit gewijzigd worden.

### Right to erasure (AVG art. 17)
`DELETE /api/v1/events?user_id=X` (admin-only) verwijdert alle events
van een gebruiker. Een compliance-event wordt zelf gelogd als bewijs van
de erasure-uitvoering.

### DPA-rollen
- **Controller:** PAVO (klant)
- **Processor:** FactumAI dashboard + agent
- **Sub-processors:** Vercel (hosting), Supabase (database), Cloudflare
  (Workers), Anthropic (LLM)

---

## 9. Wat de agent NIET doet

- ❌ **Outbound sturen** — agent stuurt geen e-mails of berichten naar
  prospects. Alleen onderzoek + presentatie.
- ❌ **Beslissen of een lead benaderd wordt** — sales beslist altijd zelf.
- ❌ **Externe data inzien zonder publieke beschikbaarheid** — geen
  LinkedIn-scraping, geen pay-walled bronnen, geen privé-data.
- ❌ **Persoonlijke gegevens van werknemers verzamelen** — alleen
  bedrijfsgegevens. Contacten worden alleen geëxtraheerd uit publieke
  bedrijfswebsites (algemene contact-pagina's).
- ❌ **Uitleg geven over individuele werknemers** — als sales chat-vraag
  daarom vraagt, weigert agent.
- ❌ **Beslissingen maken over natuurlijke personen** — scoring is
  bedrijfs-niveau, geen persoonsbeoordeling.

---

## 10. Begrippenlijst

| Term | Betekenis |
|------|-----------|
| **SBI** | Standaard Bedrijfsindeling — de officiële Nederlandse bedrijfssector-code (bv. 41201 = "Bouw van woningen") |
| **KvK Basisprofiel** | Officiële KvK-data per bedrijf: bestuurders, vestigingen, FTE-klasse |
| **WAV** | Wet arbeid vreemdelingen — werkgevers moeten geldige werkvergunningen hebben |
| **WML** | Wet minimumloon — minimum-loon-verplichting |
| **NLA** | Nederlandse Arbeidsinspectie (voorheen "Inspectie SZW") |
| **MCP** | Model Context Protocol — standaard voor AI-tools om externe data te bevragen |
| **Cluster** | Groep gerelateerde signalen (compliance / groei / verandering) |
| **Warmte** | Lead-prioriteit: HOT (direct contacteren), WARM (binnen 2 weken), COLD (geen actie) |
| **Archetype** | Karakterisering van het lead-bedrijf (bv. "verzuim-issue") |
| **Diensten-match** | Welke PAVO-diensten passen bij de signalen van deze lead |
| **Cold-redenen** | Waarom een lead COLD is (geen NLA-events, geen arbeidsrechtzaak, etc.) |
| **Spanningsindicator** | CBS-maatstaf voor krapte arbeidsmarkt (vacatures per 100 werklozen) |
| **Vacaturegraad** | CBS-maatstaf voor wervings-druk (vacatures per 100 banen) |

---

## Wijzigingsbeheer

Voor wijzigingen aan deze SOP:
1. Update dit bestand
2. Communiceer aan sales-team via interne kanalen
3. Bij scoring-wijzigingen: documenteer in calibration-dashboard
   (`/admin/calibration`) wat de impact is

Voor vragen of incidenten: dashboard-team van FactumAI.
