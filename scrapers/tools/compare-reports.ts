// tools/compare-reports.ts
//
// Reads the latest report per scraper from output/ and produces a compact
// cross-scraper overview per company: which scraper detected which cluster,
// with how many signals, at what cost. Output is printed to stdout AND
// written to output/compare-<timestamp>.json so Sjaak can share it.

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { writeReport, OUTPUT_DIR, timestamp, errMessage } from "../shared/utils.ts";
import type { ClusterId, ScraperReport } from "../shared/types.ts";

const SCRAPER_IDS = [
  "01-website-fingerprint",
  "02-rechtspraak",
  "03-nla",
  "04-insolventie",
  "05-indeed",
  "06-google-news",
  "07-vacatures",
] as const;

type ScraperId = (typeof SCRAPER_IDS)[number];

async function latestReportFor(id: ScraperId): Promise<ScraperReport | null> {
  const entries = await readdir(OUTPUT_DIR).catch(() => [] as string[]);
  const candidates = entries
    .filter((f) => f.startsWith(`${id}-`) && f.endsWith(".json"))
    .sort();
  const last = candidates.at(-1);
  if (!last) return null;
  try {
    const raw = await readFile(resolve(OUTPUT_DIR, last), "utf8");
    return JSON.parse(raw) as ScraperReport;
  } catch (err) {
    console.warn(`kon ${last} niet lezen: ${errMessage(err)}`);
    return null;
  }
}

type CompanyRow = {
  companyId: string;
  naam: string;
  perScraper: Record<ScraperId, {
    hits: number;
    cluster1: number;
    cluster2: number;
    cluster3: number;
    context: number;
    costUsd: number;
  } | null>;
  clusterTotals: { cluster1: number; cluster2: number; cluster3: number; context: number };
  totalSignals: number;
  totalCostUsd: number;
};

function emptyPer() {
  return {
    hits: 0,
    cluster1: 0,
    cluster2: 0,
    cluster3: 0,
    context: 0,
    costUsd: 0,
  };
}

function addToCluster(row: CompanyRow["clusterTotals"], cluster: ClusterId) {
  switch (cluster) {
    case 1:
      row.cluster1 += 1;
      break;
    case 2:
      row.cluster2 += 1;
      break;
    case 3:
      row.cluster3 += 1;
      break;
    case "context":
      row.context += 1;
      break;
  }
}

async function main() {
  const reports: Record<ScraperId, ScraperReport | null> = {
    "01-website-fingerprint": null,
    "02-rechtspraak": null,
    "03-nla": null,
    "04-insolventie": null,
    "05-indeed": null,
    "06-google-news": null,
    "07-vacatures": null,
  };
  for (const id of SCRAPER_IDS) reports[id] = await latestReportFor(id);

  const companyIndex = new Map<string, CompanyRow>();
  for (const id of SCRAPER_IDS) {
    const rep = reports[id];
    if (!rep) continue;
    for (const r of rep.results) {
      const row =
        companyIndex.get(r.company.id) ??
        ({
          companyId: r.company.id,
          naam: r.company.naam,
          perScraper: Object.fromEntries(SCRAPER_IDS.map((k) => [k, null])) as CompanyRow["perScraper"],
          clusterTotals: { cluster1: 0, cluster2: 0, cluster3: 0, context: 0 },
          totalSignals: 0,
          totalCostUsd: 0,
        } as CompanyRow);

      const per = emptyPer();
      per.hits = r.hitCount;
      per.costUsd = r.cost.estimatedUsd;
      for (const s of r.signals) {
        addToCluster(row.clusterTotals, s.cluster);
        switch (s.cluster) {
          case 1:
            per.cluster1 += 1;
            break;
          case 2:
            per.cluster2 += 1;
            break;
          case 3:
            per.cluster3 += 1;
            break;
          case "context":
            per.context += 1;
            break;
        }
      }
      row.perScraper[id] = per;
      row.totalSignals += r.signals.length;
      row.totalCostUsd += r.cost.estimatedUsd;
      companyIndex.set(r.company.id, row);
    }
  }

  const rows = [...companyIndex.values()].sort(
    (a, b) => b.totalSignals - a.totalSignals,
  );

  console.log("\n=== Cross-scraper overzicht (laatste run per scraper) ===\n");
  console.log("Beschikbaar:");
  for (const id of SCRAPER_IDS) {
    const rep = reports[id];
    console.log(
      `  ${id}: ${rep ? `verdict ${rep.verdict} — ${rep.companiesAttempted} bedrijven, ${rep.totalSignals} signalen, €${rep.totalCost.estimatedUsd.toFixed(4)}` : "geen rapport"}`,
    );
  }

  console.log("\nTop bedrijven op totaal aantal signalen:");
  for (const row of rows.slice(0, 15)) {
    const c = row.clusterTotals;
    console.log(
      `  ${row.naam.padEnd(38)} signalen=${row.totalSignals}  cluster1=${c.cluster1} cluster2=${c.cluster2} cluster3=${c.cluster3} ctx=${c.context}  €${row.totalCostUsd.toFixed(4)}`,
    );
  }

  const out = {
    scraper: "compare",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    companiesAttempted: rows.length,
    companiesSucceeded: rows.length,
    totalSignals: rows.reduce((a, r) => a + r.totalSignals, 0),
    verdict: "productie_klaar" as const,
    verdict_toelichting:
      "Cross-scraper vergelijking van de meest recente run per scraper. Sorteert bedrijven op totaal aantal signalen.",
    totalCost: {
      inputTokens: 0,
      outputTokens: 0,
      estimatedUsd: rows.reduce((a, r) => a + r.totalCostUsd, 0),
    },
    results: rows,
  };

  const filename = `compare-${timestamp()}.json`;
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(resolve(OUTPUT_DIR, filename), JSON.stringify(out, null, 2), "utf8");
  console.log(`\nOverzicht weggeschreven naar output/${filename}`);
  // writeReport import kept for potential future use; suppress lint.
  void writeReport;
}

main().catch((err) => {
  console.error("Fataal:", errMessage(err));
  process.exit(1);
});
