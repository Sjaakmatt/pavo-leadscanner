// tools/generate-test-companies.ts
//
// Produces 50 realistic Dutch MKB test-companies for the scraper harness.
// Preferred path: Claude Sonnet + web_search tool (option C from briefing)
// — Claude searches the web, validates URLs and KvK numbers, returns a
// structured list we can persist to shared/test-companies.ts.
//
// Sector split requested by Sjaak:
//   15 bouw/installatie (10-50 FTE)
//   15 productie/techniek (30-150 FTE)
//   10 zakelijke dienstverlening (20-80 FTE)
//   10 retail/transport/overig (20-100 FTE)
//
// The 5 seed companies in test-companies.ts are always preserved as
// regression anchors; the generator APPENDS 45 new entries.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  SCRAPERS_ROOT,
  errMessage,
  estimateCostUsd,
  extractJson,
  getAnthropic,
  getModel,
  isDryRun,
  textOf,
  withRetry,
  withTimeout,
  writeDebug,
} from "../shared/utils.ts";
import type { TestCompany } from "../shared/types.ts";

// Keep in sync with shared/test-companies.ts — we only extend it, never
// overwrite the anchor entries.
const SEEDS: TestCompany[] = [
  {
    id: "kuin",
    naam: "Kuin B.V.",
    url: "https://www.kuin.nl",
    kvk: "37084234",
    verwachteFte: 80,
    sector: "bouw/infra",
  },
  {
    id: "vdberg-infra",
    naam: "Van den Berg Infrastructuren B.V.",
    url: "https://www.vdberginfra.nl",
    kvk: "36011370",
    verwachteFte: 110,
    sector: "bouw/infra",
  },
  {
    id: "hemmink",
    naam: "Hemmink B.V.",
    url: "https://www.hemmink.nl",
    kvk: "05024050",
    verwachteFte: 60,
    sector: "productie/techniek",
  },
  {
    id: "koopmanlogistics",
    naam: "Koopman Logistics Group",
    url: "https://www.koopman.com",
    kvk: "01037370",
    verwachteFte: 90,
    sector: "transport/logistiek",
  },
  {
    id: "buko",
    naam: "Buko Groep",
    url: "https://www.buko.nl",
    kvk: "37061910",
    verwachteFte: 120,
    sector: "bouw/infra",
  },
];

const TARGET_TOTAL = 50;
const SECTOR_TARGETS: Array<{ sector: string; count: number; fteRange: string }> = [
  { sector: "bouw/installatie", count: 15, fteRange: "10-50" },
  { sector: "productie/techniek", count: 15, fteRange: "30-150" },
  { sector: "zakelijke dienstverlening", count: 10, fteRange: "20-80" },
  { sector: "retail/transport/overig", count: 10, fteRange: "20-100" },
];

const SYSTEM_PROMPT = `Je bent een research-agent voor PAVO HR. Je zoekt 50 realistische Nederlandse MKB-bedrijven die PAVO als lead zou kunnen oppakken.

Je MOET de web_search tool gebruiken om echte bedrijven te vinden en verifieren. Verzin geen bedrijven.

Voor elk bedrijf lever je:
- id: korte kebab-case identifier (bv. "van-leeuwen-bouw")
- naam: volledige bedrijfsnaam incl. rechtsvorm (B.V. / N.V.)
- url: werkende website met https://
- kvk: KvK-nummer (8 cijfers)
- verwachteFte: geschat aantal FTE
- sector: één van: "bouw/installatie", "productie/techniek", "zakelijke dienstverlening", "retail/transport/overig"

Verplichte verdeling:
- 15 bouw/installatie (10-50 FTE)
- 15 productie/techniek (30-150 FTE)
- 10 zakelijke dienstverlening (20-80 FTE)
- 10 retail/transport/overig (20-100 FTE)

Controleer elk bedrijf actief via web_search: URL werkt, bedrijf bestaat, KvK-nummer klopt ongeveer.

Antwoord UITSLUITEND als JSON-array (geen prose eromheen, geen markdown fences). Voorbeeld:
[
  {"id":"...","naam":"...","url":"https://...","kvk":"12345678","verwachteFte":45,"sector":"bouw/installatie"},
  ...
]`;

const USER_PROMPT = `Lever 45 realistische Nederlandse MKB-bedrijven volgens de sector- en FTE-verdeling. Vermijd de volgende bekende anchor-bedrijven (die komen er later bij):
${SEEDS.map((s) => `- ${s.naam}`).join("\n")}

Focus op bedrijven die typisch PAVO-klant zouden zijn (10-200 FTE, Nederland).`;

async function askClaude(): Promise<{
  companies: TestCompany[];
  inputTokens: number;
  outputTokens: number;
}> {
  const client = getAnthropic();
  const response = await withRetry(
    () =>
      withTimeout(
        client.beta.messages.create({
          model: getModel(),
          max_tokens: 8000,
          betas: ["web-search-2025-03-05"],
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
              max_uses: 25,
            } as never,
          ],
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: USER_PROMPT }],
        }),
        180_000,
        "generate-web_search",
      ),
    { maxAttempts: 2, label: "generate-web_search" },
  );
  const raw = textOf(response.content);
  await writeDebug("generate-test-companies-raw", raw);
  let parsed: TestCompany[] = [];
  try {
    const j = extractJson<TestCompany[] | { companies: TestCompany[] }>(raw);
    parsed = Array.isArray(j)
      ? j
      : Array.isArray(j?.companies)
        ? j.companies
        : [];
  } catch (err) {
    throw new Error(`kon JSON niet parsen: ${errMessage(err)}`);
  }
  return {
    companies: parsed,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

function validateAndDedupe(
  raw: TestCompany[],
  existingIds: Set<string>,
): { valid: TestCompany[]; rejected: Array<{ company: unknown; reason: string }> } {
  const valid: TestCompany[] = [];
  const rejected: Array<{ company: unknown; reason: string }> = [];
  const seenIds = new Set<string>(existingIds);
  const seenKvks = new Set<string>();

  for (const c of raw) {
    if (!c || typeof c !== "object") {
      rejected.push({ company: c, reason: "niet-object" });
      continue;
    }
    const problems: string[] = [];
    if (!c.id || typeof c.id !== "string") problems.push("missing id");
    if (!c.naam || typeof c.naam !== "string") problems.push("missing naam");
    if (!c.url || !/^https?:\/\//.test(c.url)) problems.push("ongeldige url");
    if (!c.kvk || !/^\d{8}$/.test(c.kvk)) problems.push("ongeldig kvk");
    if (!Number.isFinite(c.verwachteFte) || c.verwachteFte < 5 || c.verwachteFte > 300)
      problems.push("fte buiten range");
    if (!c.sector) problems.push("missing sector");

    if (seenIds.has(c.id)) problems.push("duplicate id");
    if (c.kvk && seenKvks.has(c.kvk)) problems.push("duplicate kvk");

    if (problems.length) {
      rejected.push({ company: c, reason: problems.join(", ") });
      continue;
    }
    seenIds.add(c.id);
    seenKvks.add(c.kvk);
    valid.push(c);
  }
  return { valid, rejected };
}

async function persist(companies: TestCompany[]): Promise<string> {
  const path = resolve(SCRAPERS_ROOT, "shared", "test-companies.ts");
  const lines: string[] = [];
  lines.push(`import type { TestCompany } from "./types.ts";`);
  lines.push("");
  lines.push(
    `// Auto-generated by tools/generate-test-companies.ts on ${new Date().toISOString()}.`,
  );
  lines.push(
    "// De eerste 5 bedrijven zijn handmatige seeds — die blijven bij iedere regeneratie staan.",
  );
  lines.push(
    "// De overige entries zijn door Claude gegenereerd en gevalideerd.",
  );
  lines.push("");
  lines.push("export const TEST_COMPANIES: TestCompany[] = [");
  for (const c of companies) {
    lines.push("  {");
    lines.push(`    id: ${JSON.stringify(c.id)},`);
    lines.push(`    naam: ${JSON.stringify(c.naam)},`);
    lines.push(`    url: ${JSON.stringify(c.url)},`);
    lines.push(`    kvk: ${JSON.stringify(c.kvk)},`);
    lines.push(`    verwachteFte: ${c.verwachteFte},`);
    lines.push(`    sector: ${JSON.stringify(c.sector)},`);
    lines.push("  },");
  }
  lines.push("];");
  lines.push("");
  await writeFile(path, lines.join("\n"), "utf8");
  return path;
}

async function main() {
  const dry = isDryRun();
  const seedIds = new Set(SEEDS.map((s) => s.id));
  console.log(
    `\n=== generate-test-companies ${dry ? "(DRY_RUN — 10 bedrijven)" : "(50 bedrijven)"} ===\n`,
  );
  console.log("Doel-verdeling:");
  for (const s of SECTOR_TARGETS) {
    console.log(`  ${s.sector.padEnd(28)} ${s.count}×  FTE ${s.fteRange}`);
  }
  console.log("");

  const t0 = Date.now();
  const { companies, inputTokens, outputTokens } = await askClaude();
  const { valid, rejected } = validateAndDedupe(companies, seedIds);

  const needed = TARGET_TOTAL - SEEDS.length;
  const sliced = valid.slice(0, dry ? 5 : needed);
  const combined: TestCompany[] = [...SEEDS, ...sliced];

  const path = await persist(combined);

  const cost = estimateCostUsd(inputTokens, outputTokens);
  console.log(
    `\nKlaar in ${Date.now() - t0}ms. Tokens: ${inputTokens} in / ${outputTokens} uit  ·  geschatte kosten €${cost.toFixed(4)}`,
  );
  console.log(
    `Seeds: ${SEEDS.length}  ·  nieuw gegenereerd: ${sliced.length}  ·  afgewezen: ${rejected.length}`,
  );
  console.log(`Weggeschreven naar: ${path}`);

  if (rejected.length > 0) {
    const debugPath = await writeDebug(
      "generate-test-companies-rejected",
      rejected,
    );
    console.log(`Afgewezen lijst: ${debugPath}`);
  }

  // Safety check — ensure file-read + parse still works.
  try {
    const read = await readFile(path, "utf8");
    const matches = read.match(/id:\s*"/g)?.length ?? 0;
    await mkdir(resolve(SCRAPERS_ROOT, "output"), { recursive: true });
    console.log(`Validatie: ${matches} bedrijven in het bestand.`);
  } catch (err) {
    console.warn(`Warn: kon geschreven bestand niet controleren: ${errMessage(err)}`);
  }
}

main().catch((err) => {
  console.error("Fataal:", errMessage(err));
  process.exit(1);
});
