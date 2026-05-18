# Test-leads CLI

Iteratief de MCP-pijplijn tweaken zonder elke keer KvK-/Anthropic-kosten te
maken. Het script werkt op een vaste set van 51 bedrijven
(`companies.json`) en cachet ruwe MCP-responses lokaal in `./test-cache/`,
zodat alleen de eerste run de externe APIs raakt.

## Vereisten

- `.env.local` met:
  - `FACTUMAI_MCP_BEDRIJVEN_URL`
  - `FACTUMAI_MCP_VACATURES_URL`
  - `FACTUMAI_MCP_JURIDISCH_URL`
  - `FACTUMAI_MCP_NEWS_URL`
  - `ANTHROPIC_API_KEY` (alleen voor classifiers, skip met `--no-llm`)
- `npm install` (voegt `tsx` toe als devDep)

## Gebruik

```bash
# Alle 51 bedrijven, gebruik cache waar mogelijk
npm run test:leads

# Eerste run (cache leeg) of cache leeggooien:
npm run test:leads -- --refresh

# Alleen MCP-data verzamelen (geen Anthropic-tokens):
npm run test:leads -- --no-llm

# Eén bedrijf testen (handig bij prompt-tweaken):
npm run test:leads -- --only=36041158

# Schrijf naar specifieke output-file:
npm run test:leads -- --out=joz-debug.md
```

## Workflow voor classifier-tweaks

1. **Eerste run**: `npm run test:leads -- --refresh` — vult de FS-cache,
   kost je ~$1 aan Haiku tokens en MCP-tijd. Output in `./test-output/`.
2. **Tweak `lib/classification/prompts.ts` of `lib/scoring/index.ts`**.
3. **Replay**: `npm run test:leads` — leest MCP-data uit cache, draait
   alleen classifiers + scoring opnieuw. Kosten: ~$0.50 aan Haiku tokens
   (LLM-calls altijd vers).
4. Vergelijk de nieuwe Markdown-output met de vorige.

Voor 0-cost replay (geen Anthropic): `--no-llm` skipt classifiers maar
laat de MCP-cache zien zodat je kunt verifiëren dat de raw data klopt.

## Cache-structuur

```
test-cache/
  09013687/                       # KvK-nummer
    inferred-website.json         # alleen als KvK geen URL gaf
    website.json                  # WebsiteScrapeResult
    vacatures.json                # VacatureRawResult
    rechtspraak.json              # RechtspraakRawResult
    nla.json                      # NlaRawResult (stub: leeg)
    insolventie.json              # InsolventieRawResult (stub: leeg)
    news.json                     # NewsRawResult
  23035139/
    ...
```

`test-cache/` en `test-output/` staan in `.gitignore` — niet committen.

## Opbouw uitvoer

Elk bedrijf krijgt een sectie met:
- Plaats / FTE / SBI
- Website-bron (KvK / inferred / geen)
- Raw-counts per MCP-bron (vacatures-aantal, rechtspraak-hits, etc.)
- Warmte + score + archetype (uit `scoreCompany`)
- Lijst signalen met categorie, cluster, sterkte, confidence, observatie
- Top-2 bewijsquotes per signaal
- Diensten-match (D1-D13)

Vergelijk runs door `diff` op twee Markdown-files — prompt-veranderingen
laten zien hoe scores en signalen verschuiven.

## Bedrijfslijst aanpassen

Voeg/verwijder bedrijven in `companies.json`. Velden:
```json
{
  "kvk": "12345678",
  "naam": "Voorbeeld B.V.",
  "handelsnaam": "Voorbeeld",
  "websiteUrl": "https://voorbeeld.nl",   // null → inference
  "sbiCodes": ["41000"],
  "fteKlasse": "20-49",
  "plaats": "Amsterdam"
}
```

Na wijziging: cache van het oude KvK-nummer kan blijven staan; het script
gebruikt de nieuwe niet aanwezige nummers vers.
