#!/usr/bin/env tsx
/**
 * Test-leads CLI — draait de MCP-pijplijn op een vaste set bedrijven met
 * lokale filesystem-cache, zodat je classifier en scoring kunt tweaken
 * zonder iedere iteratie de MCPs (en bijhorende tijd/quota) opnieuw te
 * raken. KvK-basisprofielen zijn buiten scope: dit script werkt op een
 * vooraf opgeslagen bedrijfslijst (./companies.json).
 *
 * Flow per bedrijf:
 *   1. Bepaal websiteUrl. Als ontbreekt → inferWebsiteUrl(naam) (cached).
 *   2. Fetch 4 MCPs (website / vacatures / rechtspraak / NLA / insolventie /
 *      news) met `fetchWithFsCache`: leest uit ./test-cache/<kvk>/<tool>.json
 *      tenzij --refresh meegegeven.
 *   3. Roep classifiers aan op de cached data (Claude Haiku — kost tokens
 *      maar geen MCP-quota). Skip met --no-llm voor MCP-only test.
 *   4. Score met `scoreCompany` en log een Markdown-sectie per bedrijf.
 *
 * Gebruik:
 *   npm run test:leads                       # alle bedrijven, gebruik cache
 *   npm run test:leads -- --refresh          # cache leeggooien voor MCP-fetch
 *   npm run test:leads -- --no-llm           # alleen MCP-data verzamelen
 *   npm run test:leads -- --only=36041158    # één bedrijf testen
 *   npm run test:leads -- --out=run.md       # rapport naar file
 *
 * Output: ./test-output/<timestamp>.md tenzij --out anders zegt.
 */
import 'dotenv/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { McpHttpClient, type TenantContext } from '@/lib/mcp/client';
import { BedrijvenMcp, requireBedrijvenUrl } from '@/lib/mcp/bedrijven';
import { VacaturesMcp, requireVacaturesUrl } from '@/lib/mcp/vacatures';
import { JuridischMcp, requireJuridischUrl } from '@/lib/mcp/juridisch';
import { NewsMcp, requireNewsUrl } from '@/lib/mcp/news';
import {
  classifyWebsite,
  classifyVacatures,
  classifyRechtspraak,
  classifyNla,
  classifyInsolventie,
  classifyNews,
} from '@/lib/classification';
import { inferWebsiteUrl } from '@/lib/orchestrator/website-inference';
import { scoreCompany, type StoredSignal } from '@/lib/scoring';
import type { Signaal } from '@/lib/scoring/types';
import type { KvkBasisprofiel } from '@/lib/kvk/types';
import type {
  WebsiteScrapeResult,
  VacatureRawResult,
  RechtspraakRawResult,
  NlaRawResult,
  InsolventieRawResult,
  NewsRawResult,
} from '@/lib/mcp/schemas';
import companiesData from './companies.json';

const CACHE_DIR = './test-cache';
const OUTPUT_DIR = './test-output';

interface TestCompany {
  kvk: string;
  naam: string;
  handelsnaam?: string;
  websiteUrl: string | null;
  sbiCodes: string[];
  fteKlasse: string;
  plaats: string;
}

type CliFlags = {
  refresh: boolean;
  noLlm: boolean;
  only?: string;
  out?: string;
};

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  return {
    refresh: args.includes('--refresh'),
    noLlm: args.includes('--no-llm'),
    only: args.find((a) => a.startsWith('--only='))?.split('=')[1],
    out: args.find((a) => a.startsWith('--out='))?.split('=')[1],
  };
}

async function main(): Promise<void> {
  const flags = parseFlags();
  const companies = (companiesData as TestCompany[]).filter(
    (c) => !flags.only || c.kvk === flags.only,
  );

  if (companies.length === 0) {
    console.error(`Geen bedrijf gevonden voor --only=${flags.only}`);
    process.exit(1);
  }

  const ctx: TenantContext = {
    organizationId: 'test-org',
    agentId: 'test-leads-cli',
    toolCallId: randomId(),
  };
  const mcps = {
    bedrijven: new BedrijvenMcp(new McpHttpClient(requireBedrijvenUrl())),
    vacatures: new VacaturesMcp(new McpHttpClient(requireVacaturesUrl())),
    juridisch: new JuridischMcp(new McpHttpClient(requireJuridischUrl())),
    news: new NewsMcp(new McpHttpClient(requireNewsUrl())),
  };

  const sections: string[] = [];
  let idx = 0;
  for (const c of companies) {
    idx += 1;
    console.log(`\n[${idx}/${companies.length}] ${c.naam} (${c.kvk})`);
    try {
      const section = await testCompany(c, ctx, mcps, flags);
      sections.push(section);
    } catch (err) {
      console.error(`  FOUT: ${String(err)}`);
      sections.push(`## ${c.naam} (${c.kvk})\n\n**FOUT:** ${String(err)}\n`);
    }
  }

  const report = buildReport(sections, flags);
  const outPath =
    flags.out ?? path.join(OUTPUT_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, report, 'utf-8');
  console.log(`\nReport: ${outPath}`);
}

async function testCompany(
  c: TestCompany,
  ctx: TenantContext,
  mcps: {
    bedrijven: BedrijvenMcp;
    vacatures: VacaturesMcp;
    juridisch: JuridischMcp;
    news: NewsMcp;
  },
  flags: CliFlags,
): Promise<string> {
  // 1) Resolve website (KvK-aangeleverd of inferred)
  let websiteUrl = c.websiteUrl;
  let websiteSource: 'kvk' | 'inferred' | 'none' = c.websiteUrl ? 'kvk' : 'none';
  if (!websiteUrl) {
    websiteUrl = await fetchWithFsCache<string | null>(
      c.kvk,
      'inferred-website',
      flags.refresh,
      async () => (await inferWebsiteUrl(c.naam)) ?? null,
    );
    if (websiteUrl) websiteSource = 'inferred';
  }

  // 2) Fetch 6 raw datasets (parallel)
  const handle = { kvk: c.kvk, naam: c.naam, zoeknamen: [c.naam, c.handelsnaam].filter(Boolean) as string[] };
  const [website, vacatures, rechtspraak, nla, insolventie, news] = await Promise.all([
    websiteUrl
      ? fetchWithFsCache<WebsiteScrapeResult | null>(c.kvk, 'website', flags.refresh, () =>
          mcps.bedrijven.getCompanyWebsiteContent(ctxFor(ctx), { url: websiteUrl!, maxPages: 5 }),
        )
      : Promise.resolve(null),
    websiteUrl
      ? fetchWithFsCache<VacatureRawResult | null>(c.kvk, 'vacatures', flags.refresh, () =>
          mcps.vacatures.extractVacanciesFromCompanySite(ctxFor(ctx), { url: websiteUrl! }),
        )
      : Promise.resolve(null),
    fetchWithFsCache<RechtspraakRawResult | null>(c.kvk, 'rechtspraak', flags.refresh, () =>
      mcps.juridisch.searchCourtCases(ctxFor(ctx), {
        company_names: handle.zoeknamen,
        legal_area: 'arbeidsrecht',
      }),
    ),
    fetchWithFsCache<NlaRawResult | null>(c.kvk, 'nla', flags.refresh, () =>
      mcps.juridisch.searchLaborInspections(ctxFor(ctx), { search_term: c.naam }),
    ),
    fetchWithFsCache<InsolventieRawResult | null>(c.kvk, 'insolventie', flags.refresh, () =>
      mcps.juridisch.searchInsolvencies(ctxFor(ctx), { company_names: handle.zoeknamen }),
    ),
    fetchWithFsCache<NewsRawResult | null>(c.kvk, 'news', flags.refresh, () =>
      mcps.news.searchCompanyNews(ctxFor(ctx), { company_name: c.naam, max_results: 20 }),
    ),
  ]);

  // 3) Classify (skip wanneer --no-llm)
  const allSignals: Signaal[] = [];
  if (!flags.noLlm) {
    const classifierHandle = { kvk: c.kvk, naam: c.naam };
    const tasks: Array<Promise<Signaal[]>> = [];
    if (website) tasks.push(classifyWebsite(classifierHandle, website));
    if (vacatures) tasks.push(Promise.resolve(classifyVacatures(classifierHandle, vacatures)));
    if (rechtspraak) tasks.push(classifyRechtspraak(classifierHandle, rechtspraak));
    if (nla) tasks.push(classifyNla(classifierHandle, nla));
    if (insolventie) tasks.push(Promise.resolve(classifyInsolventie(classifierHandle, insolventie)));
    if (news) tasks.push(classifyNews(classifierHandle, news));
    const results = await Promise.all(tasks);
    for (const r of results) allSignals.push(...r);
  }

  // 4) Score — stub minimaal profile zodat scoreCompany werkt
  const profileStub = {
    kvkNummer: c.kvk,
    naam: c.naam,
    handelsnaam: c.handelsnaam,
    websiteUrl: websiteUrl ?? undefined,
    sbiCodes: c.sbiCodes,
    fteKlasse: c.fteKlasse as KvkBasisprofiel['fteKlasse'],
    bestuursvorm: 'Besloten Vennootschap',
    oprichtingsdatum: undefined,
    actief: true,
    bestuurders: [],
    vestigingen: [],
    plaats: c.plaats,
    raw: null,
  } as KvkBasisprofiel;
  const stored: StoredSignal[] = allSignals.map((s) => ({
    categorie: s.categorie,
    cluster: typeof s.cluster === 'number' ? s.cluster : null,
    sterkte: s.sterkte,
    confidence: s.confidence,
    observatie: s.observatie,
    detected_at: new Date().toISOString(),
    bron_type: s.bronType,
    bron_url: s.bronUrl,
    bewijs: s.bewijs,
  }));
  const score = scoreCompany(profileStub, stored);

  return formatCompanySection(c, websiteSource, websiteUrl, allSignals, score, {
    website: !!website,
    vacatures: vacatures?.vacatures.length ?? 0,
    rechtspraak: rechtspraak?.uitspraken.length ?? 0,
    nla: nla?.overtredingen.length ?? 0,
    insolventie: insolventie?.zaken.length ?? 0,
    news: news?.items.length ?? 0,
  });
}

// Per-tool eigen toolCallId zodat dashboard-tracing klopt.
function ctxFor(parent: TenantContext): TenantContext {
  return {
    organizationId: parent.organizationId,
    agentId: parent.agentId,
    toolCallId: randomId(),
    parentCallId: parent.toolCallId,
  };
}

async function fetchWithFsCache<T>(
  kvk: string,
  tool: string,
  refresh: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  const cachePath = path.join(CACHE_DIR, kvk, `${tool}.json`);
  if (!refresh) {
    try {
      const data = await fs.readFile(cachePath, 'utf-8');
      console.log(`  ✓ ${tool} (cache)`);
      return JSON.parse(data) as T;
    } catch {
      // cache miss — doorvallen naar fetch
    }
  }
  try {
    const t0 = Date.now();
    const result = await fn();
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`  ✓ ${tool} (fresh, ${Date.now() - t0}ms)`);
    return result;
  } catch (err) {
    console.warn(`  ✗ ${tool} faalde: ${String(err)}`);
    return null as unknown as T;
  }
}

function formatCompanySection(
  c: TestCompany,
  websiteSource: 'kvk' | 'inferred' | 'none',
  websiteUrl: string | null,
  signals: Signaal[],
  score: ReturnType<typeof scoreCompany>,
  rawCounts: {
    website: boolean;
    vacatures: number;
    rechtspraak: number;
    nla: number;
    insolventie: number;
    news: number;
  },
): string {
  const websiteLabel =
    websiteSource === 'kvk'
      ? `KvK → ${websiteUrl}`
      : websiteSource === 'inferred'
        ? `inferred → ${websiteUrl}`
        : 'GEEN (skip website + vacatures)';

  const lines: string[] = [
    `## ${c.naam} (${c.kvk})`,
    '',
    `- Plaats: ${c.plaats} · FTE: ${c.fteKlasse} · SBI: ${c.sbiCodes.join(', ')}`,
    `- Website: ${websiteLabel}`,
    `- Raw: website=${rawCounts.website ? '✓' : '–'}, vacatures=${rawCounts.vacatures}, rechtspraak=${rawCounts.rechtspraak}, nla=${rawCounts.nla}, insolventie=${rawCounts.insolventie}, news=${rawCounts.news}`,
    `- Warmte: **${score.warmte}** · Score: ${score.totale_score} · ${score.archetype?.code ?? '–'} ${score.archetype?.naam ?? ''}`,
    `- Reden: ${score.warmte_reden}`,
    '',
  ];

  if (signals.length === 0) {
    lines.push('_Geen signalen gedetecteerd._');
  } else {
    lines.push('### Signalen');
    for (const s of signals) {
      const cluster = typeof s.cluster === 'number' ? `c${s.cluster}` : s.cluster;
      lines.push(
        `- **${s.categorie}** (${cluster} · ${s.bronType} · sterkte ${s.sterkte}/100 · conf ${s.confidence}/100) — ${s.observatie}`,
      );
      if (s.bewijs && s.bewijs.length > 0) {
        for (const b of s.bewijs.slice(0, 2)) {
          lines.push(`  - bewijs: "${b.length > 120 ? b.slice(0, 120) + '…' : b}"`);
        }
      }
    }
  }

  if (score.diensten_match.length > 0) {
    lines.push('', '### Diensten-match');
    for (const d of score.diensten_match) {
      lines.push(`- ${d.code} ${d.naam}: ${d.score} (${d.prioriteit})`);
    }
  }

  return lines.join('\n');
}

function buildReport(sections: string[], flags: CliFlags): string {
  const header = [
    `# Test-leads run — ${new Date().toISOString()}`,
    '',
    `Bedrijven: ${sections.length} · cache-mode: ${flags.refresh ? 'refresh' : 'reuse'} · LLM: ${flags.noLlm ? 'off' : 'on'}`,
    flags.only ? `· filter: --only=${flags.only}` : '',
    '',
    '---',
    '',
  ].join('\n');
  return header + sections.join('\n\n---\n\n') + '\n';
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
