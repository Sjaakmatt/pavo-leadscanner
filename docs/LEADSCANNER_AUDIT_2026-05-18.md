# Leadscanner audit — data-volledigheid

> **Datum:** 2026-05-18 · **Doel:** vaststellen of de prod-mode pipeline
> *daadwerkelijk* alle locaties, alle bedrijven én alle relevante
> profielen-pagina's binnen het bedrijf vindt voordat we deze week live
> gaan. Bevindingen zijn gerangschikt op urgentie (blocker → minor).
>
> **Verdict (TL;DR): de prod-mode pipeline is op dit moment niet live-ready.**
> Drie blockers (B1-B3) maken dat `kvk_zoeken` ofwel crasht ofwel een
> handvol bedrijven retourneert i.p.v. een complete branche-set; nog
> twee blockers (B4-B5) maken dat HR-rol-detectie systematisch faalt
> voor het primaire FTE-segment van PAVO. De rest is "P1 voor week 2" —
> belangrijk, niet fataal.

## 1. Vinden we alle locaties binnen de radius?

**Conclusie: nee — er is geen radius → plaatsen-conversie. De huidige
`kvk_zoeken`-call faalt op het MCP-contract.**

### B1 — `kvk_zoeken` contract is gebroken (BLOCKER)

`lib/lead-source/production.ts:96` roept aan:

```ts
this.bedrijven.kvkZoeken(searchCtx, { sbiCodes, provincies, limit: 200 })
```

De MCP-tool definieert dit schema (`factumai-mcps/packages/mcp-bedrijven/src/tools/kvk-zoeken.ts:7-35`):

```ts
plaatsen: z.array(z.string().min(1)).min(1)   // VERPLICHT
type, naam, inclusiefInactief, limit          // optioneel
```

Er is **geen** `sbiCodes`- of `provincies`-parameter. De zod-input-
validatie in de MCP-server gooit een hard error bij iedere call vanuit
de leadscanner. Resultaat: prod-mode draait nul bedrijven binnen.

Bron: KvK Zoeken-API v2 ondersteunt zelf ook geen SBI- of provincie-
filter (zie comment in `kvk-zoeken.ts:11-13`). De gedachte achter de
leadscanner-code stamt uit een eerdere MCP-iteratie die met
`provincies` werkte. De refactor (zie `MIGRATION_WEBSCRAPER_TO_DOMAIN_MCPS.md`)
heeft het contract gewijzigd; de consumer is niet meegegaan.

### B2 — Output-schema mismatch op `KvkZoekHit` (BLOCKER)

`lib/mcp/schemas.ts:15-35` definieert lokaal:

```ts
sbiCodes: z.array(z.string()),                 // REQUIRED
adres.provincie: z.string().optional(),
```

De shared schema in factumai-mcps (`packages/shared/src/schemas/bedrijven.ts:13-27`)
bevat geen `sbiCodes` en geen `provincie`-veld op het adres — comment
"Bevat geen sbiCodes (die zitten alleen in KvkBasisprofiel)" is
expliciet. De adapter (`kvk-handelsregister.ts:592-609`,
`mapSearchItemV2`) levert ook géén sbiCodes/provincie. Zelfs als B1
gefixt wordt, kraakt de zod-parse aan leadscanner-zijde op iedere hit.

### B3 — Geen "center + radius → plaatsen"-conversie (BLOCKER)

Er bestaat in `lib/geo/pdok.ts` alleen `provincesWithinRadius()` — die
levert provincie-namen. Maar de MCP heeft *plaatsen* nodig.
Conceptueel ontbreekt:

```
center(lat,lng) + radiusKm  →  plaatsen[] (alle ~2500 NL woonplaatsen,
                              gefilterd op haversine ≤ radius)
```

Zonder dit functioneert de regio-filter überhaupt niet als input voor
`kvk_zoeken`. PDOK levert via Locatieserver een lijst van alle
woonplaatsen op (`fq=type:woonplaats`, paginated); die kan als basis
dienen, gecached op disk (de set wijzigt zelden — gemeentelijke
herindelingen).

**Aanbevolen oplossing**: een nieuwe `plaatsenWithinRadius(center, km)`
helper die:
1. eerst kijkt in een ge-bundelde JSON van NL-woonplaatsen + centroïden
   (we hebben de centroïde-lookup al in `companies.lat/lng` zitten),
2. anders PDOK queryt voor alle plaatsen en lokaal in een
   bestand/cache opslaat.

### B4 — `limit: 200` is een under-cap voor heel NL (BLOCKER voor "alle bedrijven")

`kvk_zoeken` hardcapt op 200 per request, met server-cap op 500
(`kvk-handelsregister.ts:116`). Voor een branche als "Productie &
techniek" (24 SBI-prefixes × duizenden bedrijven per provincie) is dat
ruim te weinig om te claimen dat we "alle bedrijven in dat gebied"
vinden.

Daarnaast: de adapter paginates correct binnen één plaats (KvK
PAGE_SIZE 100), maar stopt zodra de gecombineerde `hits.length >=
limit`. Bij 200 plaatsen × 100 hits zou een rijke regio dus al na 2
plaatsen vol zitten en de overige 198 nooit raken.

**Aanbevolen oplossing**: per-plaats limit (bijv. 100/plaats), niet
één globale; en/of de cap drastisch verhogen (5000+) met progress-
events naar de UI zodat de gebruiker weet dat het langer duurt.

## 2. Vinden we alle bedrijven in dat gebied (incl. branche-filter)?

**Conclusie: nee — SBI-filtering kan überhaupt niet in de zoek-fase
gebeuren, dus we doen full-table-scan over alle hoofdvestigingen in
elke plaats.**

### B5 — SBI-filter komt pas ná `kvk_basisprofiel` — kostbaar (BLOCKER voor live)

KvK Zoeken-API v2 levert geen SBI in de zoek-hit. Dat betekent: om
binnen "Bouw & installatie" (SBI 41/42/43) te filteren moet je *voor
iedere hit* een `kvk_basisprofiel`-call doen.

Met de huidige hard-cap (200 candidates) en `KVK_BASISPROFIEL_CONCURRENCY = 8`
parallel, betekent dat:

- 200 calls × ~300ms = ~7,5s alleen voor basisprofielen.
- KvK API-quota: bij echte schaal (5000+ candidates voor heel NL) hit
  je gegarandeerd rate-limiting (KvK staat ~10 req/s toe).
- Kosten: KvK Basisprofiel is een betaalde call (€-cent per request).
  5000 calls/search × N searches/dag → significant.

**Aanbevolen oplossing**: de leadscanner aan KvK's eigen
**SBI-Zoeken**-endpoint (`/api/v2/zoeken?sbi=4120`) hangen via een
nieuwe MCP-tool, OF basisprofielen alleen ophalen voor bedrijven
binnen de radius (geo-filter eerst toepassen op de zoek-hit `plaats`,
*daarna* basisprofielen). De huidige code haalt basisprofielen op
*vóór* de geo-filter (`production.ts:114-145`) wat in een grote regio
zelfs zonder SBI-filter al 5000+ calls oplevert.

### B6 — Geo-filter laat bedrijven zonder `plaats` door (potentieel false-positives)

`production.ts:391`:
```ts
if (!profile.plaats) return true;   // ← inclusief, geen filter
if (!coords) return true;            // ← idem
```

Geocoding mislukt → bedrijf blijft in de set, ongeacht of het binnen
de radius ligt. In een typische run is dat <2% en acceptabel als
"liever te ruim dan te krap", maar het maakt de "alle bedrijven in
het gebied"-claim niet hard.

### B7 — `actief: false`-bedrijven worden niet expliciet uitgesloten

`kvk_zoeken` default `inclusiefInactief = false` (goed), maar
`kvk_basisprofiel` retourneert ook uitgeschreven entiteiten en
leadscanner filtert daar niet expliciet op. `profile.actief` wordt
opgeslagen maar niet getoetst tussen profile-fetch en scoring.

## 3. Worden de "huidige profielen binnen het bedrijf" doorzocht? (over-ons, team, HR-rollen)

**Conclusie: voor de website-route grotendeels ja, maar twee
kritieke gaten maken dat HR-rol-detectie systematisch faalt voor
het primaire PAVO-segment.**

### Wat goed gaat (MCP-niveau)

`mcp-bedrijven.get_company_website_content` (`packages/mcp-bedrijven/src/adapters/kvk-handelsregister.ts:230-275`) doet:

1. **Playwright crawl** van homepage + max 5 deep-links, filterend op
   `RELEVANT_PATH_REGEX` (`browser-fetcher.ts:126`):
   `about|over|team|werken|werken-bij|career|vacatur|jobs|contact|wie|missie|nieuws|press`.
2. **Aanvullende HR-paths** bovenop de crawl (`kvk-handelsregister.ts:60-72`):
   `/team`, `/over-ons`, `/over`, `/about`, `/about-us`, `/werken-bij`,
   `/vacatures`, `/contact`, `/medewerkers`, `/onze-mensen`,
   `/wie-zijn-wij` — best-effort, 200 OK + ≥100 chars.
3. **JSON-LD ContactPoints + contact-links** worden per pagina
   geëxtraheerd (e-mailadressen, sociale links).

Dit dekt de "over-ons" en "team"-content goed; per pagina komt
max 8 000 chars text mee (line 428: `text.slice(0, 8_000)`).

### B8 — Classifier kapt op 4 000 chars per pagina (BLOCKER voor team-pages)

`lib/classification/index.ts:35`:
```ts
.map((p) => `### ${p.url}\n${p.text.slice(0, 4000)}`)
```

De MCP levert tot 8 000 chars per pagina; de classifier knipt vervolgens
op 4 000. Voor een team-pagina met 30+ profielen (foto + naam + functie
+ korte bio) ben je daar zó doorheen — de eerste 8-10 namen halen het,
de rest wordt afgekapt. Resultaat: een bedrijf met een HR Business
Partner als #20 op de pagina krijgt onterecht `geen_hr_rol_zichtbaar`.

**Aanbevolen oplossing**: pre-extracteer alleen namen+functies uit de
team-pagina via een lichte HTML-parser (de raw HTML is al in scope via
`extractContactLinks`), en stuur de classifier een gecondenseerd
"functie-overzicht" i.p.v. de tekst die door alle marketing-bla loopt.

### B9 — `geen_hr_rol_zichtbaar` regel zegt "30+ FTE", UI-filter begint bij 10 FTE (BLOCKER)

`lib/classification/prompts.ts:14`:
```
- geen_hr_rol_zichtbaar — geen HR-functie zichtbaar bij bedrijf met 30+ FTE
```

UI-filter `FteKlasse`: `"10-19" | "20-49" | "50-99" | "100-199"`
(`lib/adapters/types.ts:60`). Een bedrijf met 10-29 FTE — precies
PAVO's sweet-spot — krijgt het signaal nooit, want de classifier
volgt strikt de "30+"-regel. Tegelijk krijgt de classifier nergens
het *werkelijke* FTE-getal van het bedrijf in de user-prompt, dus
hij heeft ook geen manier om te checken of de drempel klopt.

**Aanbevolen oplossing**:
- `buildClassifierUserPrompt` uitbreiden met `Bedrijf: X (KvK Y) ·
  ~F FTE` zodat de classifier het kan meewegen, of
- De 30+-regel uit de prompt slopen en de FTE-grens in de
  *scoring-laag* zetten (waar we KvK's `totaalWerkzamePersonen`
  beschikbaar hebben), of
- De drempel verlagen naar 15 FTE (klopt beter met PAVO's filter-
  segment).

### B10 — `bestuurders` zijn altijd leeg → founder_run-detectie alleen via website

`packages/mcp-bedrijven/src/adapters/kvk-handelsregister.ts:632`:
```ts
const bestuurders: KvkBestuurder[] = [];   // expliciet leeg
```

Comment in zelfde file: "Bestuurders zitten niet in /basisprofielen/{kvk}
— die hebben hun eigen sub-resource (/basisprofielen/{kvk}/eigenaar/bestuurders).
Voor nu lege array; later optioneel als aparte adapter-method."

Daardoor heeft de scoring-engine geen ground-truth over wie er aan
het roer staat. `founder_run` (cluster 3, dienst D6 gewicht 35) komt
nu alleen uit website-classificatie ("over Jan Pietersen, oprichter…")
— matig betrouwbaar.

**Aanbevolen oplossing**: de KvK basisprofiel-adapter uitbreiden met
de bestuurders sub-resource (één extra v1-call per bedrijf) en
opslaan in `kvk_snapshots` zodat scoring + founder-detectie deze
data kan gebruiken.

### B11 — `search_labor_inspections` en `search_insolvencies` zijn nog stubs

Bevestigd in `MIGRATION_WEBSCRAPER_TO_DOMAIN_MCPS.md:40-46` en
`mcp-juridisch/src/adapters/types.ts:32`. Beide geven lege resultaten
terug. Dat betekent:

- `arbo_boete_recent`, `arbeidsinspectie_stillegging` → komen nooit
  voor in productie.
- `failliet_of_surseance` (de uitsluit-flag!) → werkt niet, dus
  failliete bedrijven kunnen alsnog HOT-warm gescoord worden.

De insolventie-stub is met name pijnlijk omdat het een *hard
uitsluit-criterium* is (`classifyInsolventie` levert sterkte 100
context-signaal), niet een nice-to-have. Sales die een HOT-lead krijgt
voor een failliet bedrijf is een directe imago-knauw.

## 4. Overige observaties (P1 voor week 2, geen blockers)

### O1 — Cache TTL's verdund

- Raw-cache (orchestrator): 14 dagen
- Signals (TTL voor scrape-skip): 30 dagen
- Lead detail (per-KvK refresh): 7 dagen

Voor de live-launch is dit redelijk, maar in de eerste week willen
we *snellere* feedback. Tip: `MODE=prod` runs in week-1 met
`refresh=true` query-param, of TTL tijdelijk op 1 dag.

### O2 — Zod `passthrough()` maskeert MCP-contract-driften

Iedere root-schema in `lib/mcp/schemas.ts` heeft `.passthrough()`. Goed
voor compat, maar daardoor merken we contract-driften (zoals B2) pas
in productie. Suggestie: in CI een minimale "smoke-test" tegen alle
vier MCPs draaien die een snapshot van iedere tool-response vergelijkt
met de leadscanner-schema, en faalt op missende verplichte velden.

### O3 — Geen rate-limiting tussen leadscanner ↔ MCP

`McpHttpClient` heeft circuit-breaker (5 fails in 30s → open 60s) en
retry (max 3 attempts) maar geen token-bucket / RPS-cap. Bij 200
candidates met 8 parallel basisprofiel-calls plus 5 scrape-tasks per
bedrijf knal je relatief makkelijk door de KvK-quota.

### O4 — `scrape_news` zoekt op `naam` (statutair), niet `handelsnamen`

`scrape-and-classify.ts:189-193` stuurt `company_name: company.naam`
naar `search_company_news`. Voor bedrijven met een herkenbare
handelsnaam ("Albert Heijn") die niet aansluit op de statutaire naam
("Albert Heijn B.V." vs "Koninklijke Ahold Delhaize") mis je 80% van
het nieuws.

**Aanbevolen oplossing**: meerdere namen meegeven (zoals court_cases
al doet) en het MCP-contract uitbreiden naar `company_names: string[]`.

### O5 — Stream-route `/api/search/stream` is geschreven maar niet bedraad

README §"Bekende gaps" noemt dit al. Voor de live-launch hoeft het
niet, maar als de search-duur naar 30s+ groeit (zie B4/B5) verslechtert
de UX merkbaar. SSE-bedraden is een halve dag werk.

### O6 — `factum.logEvent` / `pushMetrics` is fire-and-forget zonder error-handling

`/api/search/route.ts:24-43` doet `void factum.…(…)` voor alle dashboard-
events. Bij een netwerk-hick of een verkeerd geconfigureerde
`FACTUM_DASHBOARD_URL` worden de fouten silently geslikt — fine voor
demo, maar in week-1 wil je weten of de dashboard-logging het overleeft.
Op z'n minst een structured-log op `console.error`.

## 5. Voorgestelde fix-volgorde voor live deze week

| # | Wijziging | Bestand(en) | Eff |
|---|-----------|-------------|-----|
| 1 | Schrijf `plaatsenWithinRadius(center, km)` met een gebundelde NL-woonplaats-JSON (van PDOK). | nieuw `lib/geo/plaatsen.ts` + JSON | 4u |
| 2 | Vervang `kvkZoeken` call: stuur `{ plaatsen, type: "hoofdvestiging", limit }` ipv `{ sbiCodes, provincies }`. SBI-filter pas ná basisprofiel toepassen. | `production.ts:96`, schema's | 2u |
| 3 | `KvkZoekHit`-schema: `sbiCodes` optioneel maken (default `[]`), `provincie` weg. | `lib/mcp/schemas.ts:15-35` | 0,5u |
| 4 | SBI-filter (`mapBrancheToSbi`) toepassen na `fetchBasisprofielen`, niet ervoor. | `production.ts:114-148` | 1u |
| 5 | Geo-filter vóór basisprofielen draaien (op plaats-veld uit zoek-hit). Bespaart 60-80% van de KvK-calls. | `production.ts:114-148` | 1,5u |
| 6 | Classifier-prompt: 30+ FTE-drempel verlagen naar 15+, en `Bedrijf: X · ~F FTE` injecteren in user-prompt. | `prompts.ts`, `classification/index.ts` | 1u |
| 7 | Classifier-context per pagina: 4000 → 8000 chars (of beter: pre-extract namen+functies uit team-page). | `classification/index.ts:35` | 1u (kort) / 4u (compleet) |
| 8 | Leadscanner-tabel `companies.actief = false` filteren in geo-fase. | `production.ts` | 0,5u |
| 9 | (Optioneel) `bestuurders` ophalen via KvK sub-resource. Verbetert founder_run / nieuwe_managementlaag. | mcp-bedrijven adapter | 3u |
| 10 | NLA + Insolventie stubs implementeren (insolventie eerst — uitsluit-criterium). | mcp-juridisch adapters | 1d |
| 11 | CI-smoketest die alle vier MCPs aanroept en outputs schema-valideert tegen leadscanner's lokale schemas. | nieuwe CI-step | 4u |

**Totaal voor must-have (B1-B5, B8-B9, B11 insolventie): ~2,5 dag werk
voor één engineer.** B10 + O-issues kunnen na de launch.

## 6. Aantal "leads die we missen" — back-of-envelope

Voor een typische PAVO-zoek (Bouw & installatie, 30 km rond Utrecht,
20-49 FTE):

- Werkelijk aantal kandidaten in NL-handelsregister: ~800
- Met huidige code (B1 onopgelost): **0** (crash bij `kvk_zoeken`)
- Na B1 fix maar zonder B4 (`limit: 200`): **~25%** (200 hits over
  de eerste 1-3 plaatsen die alfabetisch terugkomen)
- Na B1-B5 fix: **~95%** (resterende 5% is bedrijven met
  geocode-mismatches en multi-vestiging-edge-cases)

Met andere woorden: tot we B1+B4 fixen geeft de leadscanner systematisch
verkeerde positieven (kleine, geografisch geclusterde set) of crasht
hij. Niet live-baar.
