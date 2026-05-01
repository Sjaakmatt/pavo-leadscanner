#!/usr/bin/env tsx
/**
 * Test-leads CLI — draait de MCP-pijplijn op een vaste set bedrijven met
 * lokale filesystem-cache, zodat je classifier en scoring kunt tweaken
 * zonder iedere iteratie de MCPs (en bijhorende tijd/quota) opnieuw te
 * raken. KvK-basisprofielen zijn buiten scope: dit script werkt op een
 * vooraf opgeslagen bedrijfslijst (./companies.json).
 */
import 'dotenv/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { McpHttpClient, type TenantContext } from '@/lib/mcp/client';
import { BedrijvenMcp, requireBedrijvenUrl } from '@/lib/mcp/bedrijven';
import { VacaturesMcp, requireVacaturesUrl } from '@/lib/mcp/vacatures';
import { JuridischMcp, requireJuridischUrl } from '@/lib/mcp/juridisch';
import { NewsMcp, requireNewsUrl } from '@/lib/mcp/news';
import { buildTenantContext } from '@/lib/mcp/tenant';
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
const SAMPLES_PER_BRON = 5;

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
  verbose: boolean;
  only?: string;
  out?: string;
};

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  return {
    refresh: args.includes('--refresh'),
    noLlm: args.includes('--no-llm'),
    verbose: args.includes('--verbose'),
    only: args.find((a) => a.startsWith('--only='))?.split('=')[1],
    out: args.find((a) => a.startsWith('--out='))?.split('=')[1],
  };
}

let VERBOSE = false;

async function main(): Promise<void> {
  const flags = parseFlags();
  VERBOSE = flags.verbose;

  console.log('=== test-leads CLI ===');
  console.log(`mode: refresh=${flags.refresh} noLlm=${flags.noLlm} verbose=${flags.verbose}`);
  try {
    const ctx = buildTenantContext();
    console.log(`tenant: org=${ctx.organizationId.slice(0, 8)}… agent=${ctx.agentId.slice(0, 8)}…`);
  } catch (err) {
    console.error(
      `\nFOUT: ${String(err)}\n\n` +
        `Zet FACTUMAI_ORGANIZATION_ID en FACTUMAI_AGENT_ID in .env.local. ` +
        `Productie-MCPs weigeren calls zonder geldige tenant.`,
    );
    process.exit(1);
  }
  console.log(`bedrijven URL: ${truncate(requireBedrijvenUrl(), 60)}`);
  console.log(`vacatures URL: ${truncate(requireVacaturesUrl(), 60)}`);
  console.log(`juridisch URL: ${truncate(requireJuridischUrl(), 60)}`);
  console.log(`news URL:      ${truncate(requireNewsUrl(), 60)}`);
  if (!flags.noLlm) {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn(
        `\nWAARSCHUWING: ANTHROPIC_API_KEY niet gezet. Classifiers gaan ` +
          `falen met 401. Gebruik --no-llm of zet de key in .env.local.`,
      );
    }
  }
  console.log('');

  const companies = (companiesData as TestCompany[]).filter(
    (c) => !flags.only || c.kvk === flags.only,
  );
  if (companies.length === 0) {
    console.error(`Geen bedrijf gevonden voor --only=${flags.only}`);
    process.exit(1);
  }

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
      const section = await testCompany(c, mcps, flags);
      sections.push(section);
    } catch (err) {
      console.error(`  FATALE FOUT: ${formatError(err)}`);
      sections.push(`## ${c.naam} (${c.kvk})\n\n**FATALE FOUT:** ${String(err)}\n`);
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
  mcps: {
    bedrijven: BedrijvenMcp;
    vacatures: VacaturesMcp;
    juridisch: JuridischMcp;
    news: NewsMcp;
  },
  flags: CliFlags,
): Promise<string> {
  const parentCtx = buildTenantContext();

  let websiteUrl = c.websiteUrl;
  let websiteSource: 'kvk' | 'inferred' | 'none' = c.websiteUrl ? 'kvk' : 'none';
  if (!websiteUrl) {
    const inferred = await fetchWithFsCache<string | null>(
      c.kvk,
      'inferred-website',
      flags.refresh,
      async () => (await inferWebsiteUrl(c.naam)) ?? null,
    );
    if (inferred) {
      websiteUrl = inferred;
      websiteSource = 'inferred';
    }
  }

  const handle = {
    kvk: c.kvk,
    naam: c.naam,
    zoeknamen: [c.naam, c.handelsnaam].filter(Boolean) as string[],
  };
  const [website, vacatures, rechtspraak, nla, insolventie, news] = await Promise.all([
    websiteUrl
      ? fetchWithFsCache<WebsiteScrapeResult | null>(c.kvk, 'website', flags.refresh, () =>
          mcps.bedrijven.getCompanyWebsiteContent(childCtx(parentCtx), {
            url: websiteUrl!,
            maxPages: 5,
          }),
        )
      : Promise.resolve(null),
    websiteUrl
      ? fetchWithFsCache<VacatureRawResult | null>(c.kvk, 'vacatures', flags.refresh, () =>
          mcps.vacatures.extractVacanciesFromCompanySite(childCtx(parentCtx), {
            url: websiteUrl!,
          }),
        )
      : Promise.resolve(null),
    fetchWithFsCache<RechtspraakRawResult | null>(c.kvk, 'rechtspraak', flags.refresh, () =>
      mcps.juridisch.searchCourtCases(childCtx(parentCtx), {
        company_names: handle.zoeknamen,
        legal_area: 'arbeidsrecht',
      }),
    ),
    fetchWithFsCache<NlaRawResult | null>(c.kvk, 'nla', flags.refresh, () =>
      mcps.juridisch.searchLaborInspections(childCtx(parentCtx), { search_term: c.naam }),
    ),
    fetchWithFsCache<InsolventieRawResult | null>(c.kvk, 'insolventie', flags.refresh, () =>
      mcps.juridisch.searchInsolvencies(childCtx(parentCtx), {
        company_names: handle.zoeknamen,
      }),
    ),
    fetchWithFsCache<NewsRawResult | null>(c.kvk, 'news', flags.refresh, () =>
      mcps.news.searchCompanyNews(childCtx(parentCtx), {
        company_name: c.naam,
        max_results: 20,
      }),
    ),
  ]);

  const allSignals: Signaal[] = [];
  const classifierFailures: string[] = [];
  if (!flags.noLlm) {
    const classifierHandle = { kvk: c.kvk, naam: c.naam };
    const named: Array<{ name: string; promise: Promise<Signaal[]> }> = [];
    if (website)
      named.push({ name: 'website', promise: classifyWebsite(classifierHandle, website) });
    if (vacatures)
      named.push({
        name: 'vacatures',
        promise: Promise.resolve(classifyVacatures(classifierHandle, vacatures)),
      });
    if (rechtspraak)
      named.push({
        name: 'rechtspraak',
        promise: classifyRechtspraak(classifierHandle, rechtspraak),
      });
    if (nla) named.push({ name: 'nla', promise: classifyNla(classifierHandle, nla) });
    if (insolventie)
      named.push({
        name: 'insolventie',
        promise: Promise.resolve(classifyInsolventie(classifierHandle, insolventie)),
      });
    if (news) named.push({ name: 'news', promise: classifyNews(classifierHandle, news) });
    const settled = await Promise.allSettled(named.map((n) => n.promise));
    settled.forEach((res, i) => {
      const name = named[i].name;
      if (res.status === 'fulfilled') {
        allSignals.push(...res.value);
        if (res.value.length > 0)
          console.log(`  · classify ${name}: ${res.value.length} signaal(en)`);
      } else {
        const msg = formatError(res.reason);
        classifierFailures.push(`${name}: ${msg}`);
        console.warn(`  ✗ classify ${name} faalde: ${msg}`);
        if (VERBOSE && res.reason instanceof Error && res.reason.stack) {
          console.warn(`     stack:\n${indentLines(res.reason.stack, '       ')}`);
        }
      }
    });
  }

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
    website,
    vacatures,
    rechtspraak,
    nla,
    insolventie,
    news,
  }, classifierFailures);
}

function childCtx(parent: TenantContext): TenantContext {
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
): Promise<T | null> {
  const cachePath = path.join(CACHE_DIR, kvk, `${tool}.json`);
  if (!refresh) {
    try {
      const data = await fs.readFile(cachePath, 'utf-8');
      const parsed = JSON.parse(data) as T | null;
      if (parsed === null) {
        if (VERBOSE) console.log(`  · ${tool} cache had null, opnieuw fetchen`);
      } else {
        console.log(`  ✓ ${tool} (cache)`);
        return parsed;
      }
    } catch {
      // cache miss
    }
  }
  try {
    const t0 = Date.now();
    const result = await fn();
    if (result === null || result === undefined) {
      console.log(`  ✗ ${tool} returned null/undefined (${Date.now() - t0}ms) — niet gecached`);
      return null;
    }
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`  ✓ ${tool} (fresh, ${Date.now() - t0}ms)`);
    return result;
  } catch (err) {
    console.warn(`  ✗ ${tool} faalde: ${formatError(err)}`);
    if (VERBOSE && err instanceof Error && err.stack) {
      console.warn(`     stack:\n${indentLines(err.stack, '       ')}`);
    }
    return null;
  }
}

interface RawData {
  website: WebsiteScrapeResult | null;
  vacatures: VacatureRawResult | null;
  rechtspraak: RechtspraakRawResult | null;
  nla: NlaRawResult | null;
  insolventie: InsolventieRawResult | null;
  news: NewsRawResult | null;
}

function formatCompanySection(
  c: TestCompany,
  websiteSource: 'kvk' | 'inferred' | 'none',
  websiteUrl: string | null,
  signals: Signaal[],
  score: ReturnType<typeof scoreCompany>,
  raw: RawData,
  classifierFailures: string[],
): string {
  const websiteLabel =
    websiteSource === 'kvk'
      ? `KvK → ${websiteUrl}`
      : websiteSource === 'inferred'
        ? `inferred → ${websiteUrl}`
        : 'GEEN (skip website + vacatures)';

  const counts = {
    vacatures: raw.vacatures?.vacatures.length ?? 0,
    rechtspraak: raw.rechtspraak?.uitspraken.length ?? 0,
    nla: raw.nla?.overtredingen.length ?? 0,
    insolventie: raw.insolventie?.zaken.length ?? 0,
    news: raw.news?.items.length ?? 0,
  };

  const lines: string[] = [
    `## ${c.naam} (${c.kvk})`,
    '',
    `- Plaats: ${c.plaats} · FTE: ${c.fteKlasse} · SBI: ${c.sbiCodes.join(', ')}`,
    `- Website: ${websiteLabel}`,
    `- Raw: website=${raw.website ? '✓' : '–'}, vacatures=${counts.vacatures}, rechtspraak=${counts.rechtspraak}, nla=${counts.nla}, insolventie=${counts.insolventie}, news=${counts.news}`,
    `- Warmte: **${score.warmte}** · Score: ${score.totale_score} · ${score.archetype?.code ?? '–'} ${score.archetype?.naam ?? ''}`,
    `- Reden: ${score.warmte_reden}`,
    '',
  ];

  if (classifierFailures.length > 0) {
    lines.push('### Classifier-failures');
    for (const f of classifierFailures) lines.push(`- ${f}`);
    lines.push('');
  }

  // Per-bron raw samples — kwaliteit van MCP-resultaten zichtbaar
  // maken zodat false-positives (verkeerde rechtsgebied, homoniem-news,
  // dode vacatures) snel opvallen.
  appendVacaturesSection(lines, raw.vacatures);
  appendRechtspraakSection(lines, raw.rechtspraak);
  appendNlaSection(lines, raw.nla);
  appendInsolventieSection(lines, raw.insolventie);
  appendNewsSection(lines, raw.news);

  if (signals.length === 0) {
    lines.push('### Signalen', '', '_Geen signalen gedetecteerd._');
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

function appendVacaturesSection(lines: string[], raw: VacatureRawResult | null): void {
  if (!raw) {
    lines.push('### Vacatures', '', '_MCP-call faalde of skipt (geen websiteUrl)._', '');
    return;
  }
  const sources = raw.sourcesChecked?.length ? ` · sources: ${raw.sourcesChecked.join(', ')}` : '';
  if (raw.vacatures.length === 0) {
    lines.push(`### Vacatures (0)${sources}`, '', '_Geen vacatures gevonden._', '');
    return;
  }
  lines.push(`### Vacatures (${raw.vacatures.length})${sources}`);
  for (const v of raw.vacatures.slice(0, SAMPLES_PER_BRON)) {
    const date = v.datePosted ? formatDate(v.datePosted) : '?';
    const titleClean = clean(v.title, 100);
    lines.push(`- ${date} · "${titleClean}" — ${shortUrl(v.url)}`);
  }
  if (raw.vacatures.length > SAMPLES_PER_BRON) {
    lines.push(`- _… +${raw.vacatures.length - SAMPLES_PER_BRON} meer_`);
  }
  lines.push('');
}

function appendRechtspraakSection(
  lines: string[],
  raw: RechtspraakRawResult | null,
): void {
  if (!raw) {
    lines.push('### Rechtspraak', '', '_MCP-call faalde._', '');
    return;
  }
  const skipped = raw.pseudonimiseringSkipped?.length
    ? ` · pseudoniem-skip: ${raw.pseudonimiseringSkipped.join(', ')}`
    : '';
  if (raw.uitspraken.length === 0) {
    lines.push(
      `### Rechtspraak (0)${skipped}`,
      '',
      `_Geen arbeidsrecht-uitspraken gevonden voor: ${raw.namesTried.join(', ')}_`,
      '',
    );
    return;
  }
  lines.push(`### Rechtspraak (${raw.uitspraken.length})${skipped}`);
  for (const u of raw.uitspraken.slice(0, SAMPLES_PER_BRON)) {
    const date = formatDate(u.datum);
    const rg = u.rechtsgebied ? ` · ${u.rechtsgebied}` : '';
    const titel = u.titel ? clean(u.titel, 80) : '(geen titel)';
    lines.push(`- ${date}${rg} · ${u.ecli} — "${titel}"`);
  }
  if (raw.uitspraken.length > SAMPLES_PER_BRON) {
    lines.push(`- _… +${raw.uitspraken.length - SAMPLES_PER_BRON} meer_`);
  }
  lines.push('');
}

function appendNlaSection(lines: string[], raw: NlaRawResult | null): void {
  if (!raw) {
    lines.push('### NLA-overtredingen', '', '_MCP-call faalde._', '');
    return;
  }
  if (raw.overtredingen.length === 0) {
    const portals = raw.portalsChecked.length
      ? ` · gechecked: ${raw.portalsChecked.join(', ')}`
      : '';
    lines.push(
      `### NLA-overtredingen (0)${portals}`,
      '',
      '_Geen overtredingen gevonden (NLA-portal nog stub — implementatie volgt)._',
      '',
    );
    return;
  }
  lines.push(`### NLA-overtredingen (${raw.overtredingen.length})`);
  for (const o of raw.overtredingen.slice(0, SAMPLES_PER_BRON)) {
    const date = formatDate(o.datum);
    const wet = o.wetsartikel ? ` · ${o.wetsartikel}` : '';
    lines.push(`- ${date} · ${clean(o.type, 60)}${wet} · bron: ${o.bron}`);
  }
  if (raw.overtredingen.length > SAMPLES_PER_BRON) {
    lines.push(`- _… +${raw.overtredingen.length - SAMPLES_PER_BRON} meer_`);
  }
  lines.push('');
}

function appendInsolventieSection(
  lines: string[],
  raw: InsolventieRawResult | null,
): void {
  if (!raw) {
    lines.push('### Insolventie', '', '_MCP-call faalde._', '');
    return;
  }
  if (raw.zaken.length === 0) {
    lines.push(
      `### Insolventie (0)`,
      '',
      `_Geen faillissement/surseance voor: ${raw.namesTried.join(', ')} (insolventieregister stub — implementatie volgt)._`,
      '',
    );
    return;
  }
  lines.push(`### Insolventie (${raw.zaken.length})`);
  for (const z of raw.zaken.slice(0, SAMPLES_PER_BRON)) {
    const date = formatDate(z.startdatum);
    lines.push(`- ${date} · ${z.type.toUpperCase()} · ${clean(z.bedrijfsnaam, 80)}`);
  }
  if (raw.zaken.length > SAMPLES_PER_BRON) {
    lines.push(`- _… +${raw.zaken.length - SAMPLES_PER_BRON} meer_`);
  }
  lines.push('');
}

function appendNewsSection(lines: string[], raw: NewsRawResult | null): void {
  if (!raw) {
    lines.push('### News', '', '_MCP-call faalde._', '');
    return;
  }
  if (raw.items.length === 0) {
    lines.push(`### News (0)`, '', '_Geen nieuwsberichten gevonden._', '');
    return;
  }
  lines.push(`### News (${raw.items.length})`);
  for (const n of raw.items.slice(0, SAMPLES_PER_BRON)) {
    const date = formatDate(n.publishedAt);
    const src = n.source ? ` · ${n.source}` : '';
    lines.push(`- ${date}${src} · "${clean(n.title, 100)}" — ${shortUrl(n.url)}`);
  }
  if (raw.items.length > SAMPLES_PER_BRON) {
    lines.push(`- _… +${raw.items.length - SAMPLES_PER_BRON} meer_`);
  }
  lines.push('');
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

function clean(s: string | undefined, max: number): string {
  if (!s) return '';
  const c = s.replace(/\s+/g, ' ').trim();
  return c.length <= max ? c : c.slice(0, max - 1) + '…';
}

function formatDate(s: string | undefined): string {
  if (!s) return '?';
  // Pak alleen YYYY-MM-DD prefix wanneer dat herkenbaar is
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s.slice(0, 10);
}

function shortUrl(u: string | undefined): string {
  if (!u) return '';
  try {
    const url = new URL(u);
    const pathname = url.pathname.length > 60 ? url.pathname.slice(0, 59) + '…' : url.pathname;
    return `${url.host}${pathname}`;
  } catch {
    return u.length > 80 ? u.slice(0, 79) + '…' : u;
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function indentLines(s: string, prefix: string): string {
  return s
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
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
