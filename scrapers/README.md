# PAVO HR scrapers

Batch-scraping harness die per Nederlands MKB-bedrijf HR-signalen afleidt uit zes publieke bronnen. Alle scrapers produceren hetzelfde `Signaal`-formaat (zie `shared/types.ts`) zodat de PAVO lead-agent ze 1:1 kan consumeren.

## Snel starten

```bash
cd scrapers
cp .env.example .env        # vul ANTHROPIC_API_KEY in
npm install
npm run install:browsers    # Playwright Chromium

# Eenmalig: genereer 50 test-bedrijven (5 seeds + 45 via Claude web_search)
npm run generate:test-companies

# Dry-run — eerste 3 bedrijven per scraper, kost < €0,20
DRY_RUN=true npm run scrape:all

# Echte run — alle 50 bedrijven × 6 scrapers
npm run scrape:all

# Cross-scraper overzicht
npm run report:compare
```

Outputs landen in `output/` als JSON-rapport per scraper; debug-dumps in `output/debug/`.

## Scrapers

| # | Naam | Patroon | Bron | Verwachte hit-rate | Verdict-verwachting |
|---|------|---------|------|-------------------|--------------------|
| 1 | `01-website-fingerprint` | web_fetch + Playwright fallback | bedrijfswebsite | ~80% | productie_klaar |
| 2 | `02-rechtspraak` | HTML-parse + content-API + Claude | rechtspraak.nl | 15-25% bedrijven met hit | productie_klaar / werkt_met_aanpassing |
| 3 | `03-nla` | web_fetch + Playwright fallback | NLA portals | < 5% hits | werkt_met_aanpassing |
| 4 | `04-insolventie` | web_fetch + Playwright fallback | insolventieregister | 0-2% hits | werkt_met_aanpassing |
| 5 | `05-indeed` | Playwright stress-test | indeed.nl | n.v.t. — doel = breken | niet_werkbaar |
| 6 | `06-google-news` | RSS + fast-xml-parser + Claude | news.google.com | 30-60% bedrijven met hit | productie_klaar |

Elke scraper:
- Checkt `DRY_RUN=true` en verwerkt dan alleen de eerste 3 bedrijven.
- Logt per bedrijf: duur, hit-count, signalen, kosten, error.
- Schrijft een `ScraperReport` JSON met `verdict` (`productie_klaar` / `werkt_met_aanpassing` / `fragiel` / `niet_werkbaar`) en `verdict_toelichting` in het Nederlands.

## Signaal-framework

Drie PAVO-clusters:
- **Cluster 1 — HR-structuur** (hoogste waarde): `geen_hr_rol_zichtbaar`, `snelle_groei`, `veel_functies_geen_structuur`, `negatieve_reviews_chaos`, `verzuim_burnout_signalen`, `nieuwe_managementlaag`, `internationale_uitbreiding`, `arbeidsrechtzaak_recent`, `arbeidsrechtzaak_patroon`, `arbo_boete_recent`, `arbeidsinspectie_stillegging`, `asbest_overtreding`.
- **Cluster 2 — operationeel HR**: `veel_open_vacatures`, `langlopende_vacatures`, `herposte_vacatures`, `hiring_manager_actief`, `recruiter_overload`, `seizoenspieken`.
- **Cluster 3 — administratie**: `klein_team_in_groei`, `geen_hr_finance_roles`, `founder_run`, `veel_freelancers`, `loonadministratie_klachten`, `nieuwe_bv`.
- **Cross-cluster / context**: `bedrijfsomvang`, `bestuursvorm`, `sector_context`, `failliet_of_surseance`.

Het `cluster`-veld wordt nooit door een scraper gezet — het volgt de `categorie` via `CLUSTER_FOR` in `shared/types.ts`. Waarde is altijd `1 | 2 | 3 | "context"`, nooit `0`.

## Test-bedrijven

`shared/test-companies.ts` bevat 5 handmatige seed-bedrijven als regressie-anker. De generator (`npm run generate:test-companies`) gebruikt Claude Sonnet + web_search en voegt 45 nieuwe toe tot 50 totaal, verdeeld:

- 15 bouw/installatie (10-50 FTE)
- 15 productie/techniek (30-150 FTE)
- 10 zakelijke dienstverlening (20-80 FTE)
- 10 retail/transport/overig (20-100 FTE)

Elk gegenereerd bedrijf wordt gevalideerd op URL-formaat, 8-cijferig KvK-nummer, FTE-range, en dubbele ID's/KvK's.

## Kostenbudget (volledige run met 50 bedrijven)

| Post | Schatting |
|------|-----------|
| Scraper 1 (website) | €1,00 |
| Scraper 2 (rechtspraak) | €0,15 |
| Scraper 3 (NLA) | verwaarloosbaar |
| Scraper 4 (insolventie) | verwaarloosbaar |
| Scraper 5 (indeed) | €0 |
| Scraper 6 (news) | €0,50 |
| Test-bedrijven generator | €0,50 |
| **Totaal** | **< €2,50** |

`DRY_RUN=true npm run scrape:all` blijft onder €0,20.

## Projectprincipes

1. **Geen speculatie.** Elke scraper logt eerlijk wat WEL en NIET werkt.
2. **Fail-fast.** Time-outs van 25-45s per stap, max 3 retries met exponential backoff.
3. **Geen `cluster: 0`.** De `makeSignal()` helper dwingt dit af.
4. **Observatie NL, code Engels.** Variabelen en comments Engels, signaal-teksten Nederlands voor Roy.
5. **Strict TypeScript.** `as never` wordt alleen gebruikt op de `web_fetch` / `web_search` tool-descriptors zolang de SDK nog geen types heeft.

## Troubleshooting

- **"ANTHROPIC_API_KEY ontbreekt"**: maak `.env` aan (zie `.env.example`).
- **Playwright fails to launch**: run `npm run install:browsers` eenmalig.
- **Scraper 5 lijkt te "falen"**: dat is de bedoeling. Het verdict `niet_werkbaar` met blokkade-telling is het resultaat.
- **Scraper 2 geeft geen hits**: normaal — arbeidsrechtzaken zijn zeldzaam en BV-namen worden soms gepseudonimiseerd. De scraper skipt VOF/maatschap en "voornaam + achternaam + BV"-patronen automatisch.
