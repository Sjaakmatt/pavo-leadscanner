#!/usr/bin/env tsx
/**
 * Bulk-refresh van alle companies in de database waarvan de cache
 * stale-schema heeft (na MCP-upgrades) of langer dan TTL niet ververst.
 *
 * Run lokaal:
 *   pnpm tsx scripts/refresh-stale-companies.ts
 *
 * Of met opties:
 *   pnpm tsx scripts/refresh-stale-companies.ts --concurrency=5 --max-eur=20
 *   pnpm tsx scripts/refresh-stale-companies.ts --all   # ook fresh-cached refreshen
 *   pnpm tsx scripts/refresh-stale-companies.ts --dry   # alleen tellen, geen calls
 *
 * Vereist .env.local met: NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, KVK_API_KEY, ANTHROPIC_API_KEY,
 * FACTUMAI_MCP_BEDRIJVEN_URL (+ vacatures/juridisch/news).
 *
 * Hot-path: roept bestaande runScrapeBatch aan zoals de in-app
 * scrape-flow doet. Schema-stale tools worden door readRaw als miss
 * behandeld → fresh fetch → idempotent upsert (signals/contacts
 * worden geappendt, niet overschreven).
 */
import "dotenv/config";
import { tryGetSupabase } from "@/lib/supabase/client";
import { McpHttpClient } from "@/lib/mcp/client";
import { BedrijvenMcp, requireBedrijvenUrl } from "@/lib/mcp/bedrijven";
import { VacaturesMcp, requireVacaturesUrl } from "@/lib/mcp/vacatures";
import { JuridischMcp, requireJuridischUrl } from "@/lib/mcp/juridisch";
import { NewsMcp, requireNewsUrl } from "@/lib/mcp/news";
import { runScrapeBatch, type ScrapeMcps } from "@/lib/orchestrator";
import { buildTenantContext } from "@/lib/mcp/tenant";
import { CostTracker, withSearchScope } from "@/lib/classification/cost";
import { detectStaleTools, type CachedToolName } from "@/lib/orchestrator/raw-cache";
import { bulkRefreshLead } from "@/lib/lead-source/bulk-refresh";

const ALL_TOOLS: CachedToolName[] = [
  "get_company_website_content",
  "extract_vacancies_from_company_site",
  "search_court_cases",
  "search_labor_inspections",
  "search_insolvencies",
  "search_company_news",
];

interface Args {
  concurrency: number;
  maxEur: number;
  all: boolean;
  dry: boolean;
  ttlDays: number;
  withLlm: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    concurrency: 5,
    maxEur: 20,
    all: false,
    dry: false,
    ttlDays: 7,
    withLlm: false,
  };
  for (const a of argv) {
    if (a === "--all") args.all = true;
    else if (a === "--dry") args.dry = true;
    else if (a === "--with-llm") args.withLlm = true;
    else if (a.startsWith("--concurrency=")) args.concurrency = Number(a.split("=")[1]);
    else if (a.startsWith("--max-eur=")) args.maxEur = Number(a.split("=")[1]);
    else if (a.startsWith("--ttl-days=")) args.ttlDays = Number(a.split("=")[1]);
  }
  return args;
}

interface Company {
  kvk: string;
  naam: string;
  handelsnaam: string | null;
  website_url: string | null;
}

async function main() {
  const args = parseArgs();
  console.log(
    `▶ refresh-stale-companies — concurrency=${args.concurrency} max-eur=${args.maxEur} all=${args.all} dry=${args.dry} ttl-days=${args.ttlDays} with-llm=${args.withLlm}`,
  );
  if (args.withLlm) {
    console.log(
      "  ⚠ --with-llm: roept Anthropic Claude classifier aan per lead (~€0,03/lead). Wordt ook scored_leads-rij geinsert zodat warmte in UI ververst.",
    );
  }

  const supabaseMaybe = tryGetSupabase();
  if (!supabaseMaybe) {
    console.error("✗ Supabase niet geconfigureerd (SUPABASE_SERVICE_ROLE_KEY?)");
    process.exit(1);
  }
  // Vanaf hier is supabase non-null — bind aan een lokale const zodat
  // TS-narrowing niet verloren gaat in worker-closures hieronder.
  const supabase = supabaseMaybe;

  // 1. Lijst alle companies — paginate omdat je makkelijk >1000 rijen hebt
  const all: Company[] = [];
  const PAGE_SIZE = 500;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("companies")
      .select("kvk, naam, handelsnaam, website_url")
      .order("kvk", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error(`✗ Companies-fetch faalde: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    all.push(...(data as Company[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  console.log(`◷ ${all.length} companies in DB`);

  // 2. Filter naar wat refresh nodig heeft
  const targets: Company[] = [];
  if (args.all) {
    targets.push(...all);
    console.log(`◷ Mode --all: alles meenemen (incl. fresh cache)`);
  } else {
    let checked = 0;
    for (const c of all) {
      checked += 1;
      if (checked % 50 === 0) {
        process.stdout.write(`\r◷ Stale-detectie: ${checked}/${all.length}…`);
      }
      const stale = await detectStaleTools(supabase, c.kvk, ALL_TOOLS, args.ttlDays);
      if (stale.length > 0) targets.push(c);
    }
    process.stdout.write("\r");
    console.log(`◷ ${targets.length} companies hebben stale-schema cache of ontbreken`);
  }

  if (targets.length === 0) {
    console.log("✓ Niets te refreshen — alle cache up-to-date");
    return;
  }

  if (args.dry) {
    console.log(`\nDRY RUN — eerste 10 targets:`);
    for (const c of targets.slice(0, 10)) {
      console.log(`  ${c.kvk}  ${c.naam.slice(0, 60)}`);
    }
    return;
  }

  // 3. MCPs opbouwen
  let mcps: ScrapeMcps;
  try {
    mcps = {
      bedrijven: new BedrijvenMcp(new McpHttpClient(requireBedrijvenUrl())),
      vacatures: new VacaturesMcp(new McpHttpClient(requireVacaturesUrl())),
      juridisch: new JuridischMcp(new McpHttpClient(requireJuridischUrl())),
      news: new NewsMcp(new McpHttpClient(requireNewsUrl())),
    };
  } catch (err) {
    console.error(`✗ MCP-config ontbreekt: ${String(err)}`);
    process.exit(1);
  }

  const tracker = new CostTracker();
  const startedAt = Date.now();
  const queue = [...targets];
  let processed = 0;
  let failed = 0;
  let budgetStopped = false;
  const totalCount = targets.length;

  function eurSoFar(): number {
    return tracker.snapshot().totalUsd / 1.1;
  }

  async function worker(workerId: number): Promise<void> {
    while (queue.length > 0 && !budgetStopped) {
      const c = queue.shift();
      if (!c) break;
      const eurNow = eurSoFar();
      if (eurNow >= args.maxEur) {
        console.warn(`\n⚠ Budget €${args.maxEur} bereikt — stop alle workers`);
        budgetStopped = true;
        return;
      }

      const ctx = buildTenantContext({
        parentCallId: `bulk-refresh:${c.kvk}`,
      });

      const start = Date.now();
      try {
        if (args.withLlm) {
          // Volledige refresh INCL. Anthropic-classifier. Schrijft ook
          // scored_leads-rij zodat de leads-list de verse warmte ziet.
          const handle = {
            kvk: c.kvk,
            naam: c.naam,
            websiteUrl: c.website_url ?? undefined,
            zoeknamen: [c.naam, c.handelsnaam].filter(
              (s): s is string => !!s,
            ),
          };
          await withSearchScope(
            { tracker, supabase, searchQueryId: null },
            () =>
              runScrapeBatch([handle], ctx, mcps, supabase, {
                concurrency: 1,
                refreshRaw: args.all,
                shouldAbort: () => tracker.shouldHalt(),
              }),
          );
          processed += 1;
          const ms = Date.now() - start;
          const eur = eurSoFar();
          console.log(
            `[w${workerId}] [${processed + failed}/${totalCount}] ${c.kvk} ${c.naam.slice(0, 40).padEnd(40)} · LLM✓ · ${ms}ms · €${eur.toFixed(2)}`,
          );
        } else {
          // Raw-only refresh: GEEN classifier, alleen externe data.
          const res = await withSearchScope(
            { tracker, supabase, searchQueryId: null },
            () =>
              bulkRefreshLead(supabase, mcps, ctx, {
                kvk: c.kvk,
                naam: c.naam,
                handelsnaam: c.handelsnaam,
                websiteUrl: c.website_url,
              }),
          );
          processed += 1;
          const ms = Date.now() - start;
          const eur = eurSoFar();
          const tools = res.toolsRefreshed.length;
          const fails = res.toolsFailed.length;
          console.log(
            `[w${workerId}] [${processed + failed}/${totalCount}] ${c.kvk} ${c.naam.slice(0, 40).padEnd(40)} · ${tools}✓ ${fails > 0 ? `${fails}✗ ` : ""}· ${ms}ms · €${eur.toFixed(2)}`,
          );
        }
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[w${workerId}] [${processed + failed}/${totalCount}] ${c.kvk} ${c.naam.slice(0, 40)} FAIL: ${msg.slice(0, 100)}`,
        );
      }
    }
  }

  // 4. Workers starten
  const workers = Array.from({ length: args.concurrency }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  // 5. Samenvatting
  const totalMs = Date.now() - startedAt;
  const eur = eurSoFar();
  const tokens = tracker.snapshot();
  console.log("\n" + "═".repeat(60));
  console.log(`✓ Klaar — ${processed} succesvol, ${failed} faalden`);
  console.log(`  Doorlooptijd:   ${(totalMs / 1000).toFixed(0)}s`);
  console.log(`  Totale kosten:  €${eur.toFixed(2)}  (LLM €${(tokens.llmUsd / 1.1).toFixed(2)}, KvK €${(tokens.kvkUsd / 1.1).toFixed(2)})`);
  console.log(`  Tokens:         in=${tokens.inputTokens}  out=${tokens.outputTokens}  cache=${tokens.cacheReadTokens}`);
  if (budgetStopped) {
    console.log(`  ⚠ Stopgezet vanwege budget-cap (€${args.maxEur})`);
    console.log(`    Resterend: ${queue.length} companies — run opnieuw`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Fatal:", err);
    process.exit(1);
  });
