// Raw-only refresh van een lead — geen LLM-classifier, geen signal-
// generation. Ververst alle externe bronnen en updatet de
// deterministische upserts (companies-row, KvK-bestuurders, website-
// contacten via JSON-LD/mailto).
//
// Bedoeld voor bulk-runs (zie scripts/refresh-stale-companies.ts):
// raw-cache wordt up-to-date gebracht met de huidige MCP-schemas zodat
// een latere lead-detail-open de classifier on-demand kan draaien
// op verse data zonder langzame full-refresh-trigger.
//
// Wat hier WEL gebeurt:
//   ✓ KvK basisprofiel ophalen + companies-row updaten
//   ✓ KvK bestuurders → lead_contacts (kvk-bron)
//   ✓ Website scrapen + ContactPoints/contactLinks → lead_contacts
//   ✓ Vacatures, rechtspraak, NLA, insolventie, news → mcp_raw_responses
//   ✓ Schema-version meegeschreven zodat readRaw 'm fresh-acht
//
// Wat hier NIET gebeurt:
//   ✗ Anthropic-classifier (klaar voor on-demand bij lead-detail-open)
//   ✗ Signal-generation (signals worden later via classifier afgeleid)
//   ✗ Lead-scoring / warmte-bepaling

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/mcp/client";
import type { ScrapeMcps } from "@/lib/orchestrator";
import { persistRaw, type CachedToolName } from "@/lib/orchestrator/raw-cache";
import { resolveWebsiteUrl } from "@/lib/orchestrator/website-inference";
import {
  upsertKvkBestuurders,
  type ContactInsert,
} from "@/lib/lead-source/contacts";
import {
  deriveContactsFromPages,
  upsertDeterministicContacts,
} from "@/lib/contacts/from-website";

export interface BulkRefreshHandle {
  kvk: string;
  naam: string;
  handelsnaam?: string | null;
  websiteUrl?: string | null;
}

export interface BulkRefreshResult {
  kvk: string;
  toolsRefreshed: string[];
  toolsFailed: string[];
  durationMs: number;
}

const TOOLS: Array<{
  name: CachedToolName;
  needsWebsite?: boolean;
  needsNames?: boolean;
}> = [
  { name: "get_company_website_content", needsWebsite: true },
  { name: "extract_vacancies_from_company_site", needsWebsite: true },
  { name: "search_court_cases", needsNames: true },
  { name: "search_labor_inspections", needsNames: false },
  { name: "search_insolvencies", needsNames: true },
  { name: "search_company_news", needsNames: true },
];

export async function bulkRefreshLead(
  supabase: SupabaseClient,
  mcps: ScrapeMcps,
  ctx: TenantContext,
  handle: BulkRefreshHandle,
): Promise<BulkRefreshResult> {
  const startedAt = Date.now();
  const refreshed: string[] = [];
  const failed: string[] = [];

  const zoeknamen = [handle.naam, handle.handelsnaam]
    .filter((s): s is string => !!s && s.trim().length > 0);

  // 1. KvK basisprofiel — refresh companies-row + bestuurders. Dit is
  //    een directe DB-update, geen mcp_raw_responses-rij (die slaan
  //    we niet voor basisprofielen op; de companies-tabel IS de cache).
  //
  //    Website-resolutie: KvK registreert vrijwel altijd met `www.X.nl`
  //    maar de canonical-host is meestal `X.nl`. Voor we naar de
  //    companies-tabel schrijven proberen we de werkende variant te
  //    vinden (bare-domain prefer) zodat alle downstream-scrapes en
  //    de UI direct de juiste URL hebben.
  let resolvedSiteUrl: string | null = null;
  try {
    const profile = await mcps.bedrijven.kvkBasisprofiel(ctx, handle.kvk);
    if (profile) {
      const kvkSiteRaw: unknown = profile.websiteUrl;
      const kvkSite =
        typeof kvkSiteRaw === "string" && kvkSiteRaw.length > 0
          ? kvkSiteRaw
          : null;
      if (kvkSite) {
        resolvedSiteUrl = await resolveWebsiteUrl(kvkSite).catch(() => null);
      }
      const finalUrl = resolvedSiteUrl ?? kvkSite;

      await supabase
        .from("companies")
        .upsert(
          {
            kvk: profile.kvkNummer,
            naam: profile.naam,
            handelsnaam: profile.handelsnaam ?? null,
            website_url: finalUrl,
            sbi_codes: profile.sbiCodes,
            fte_klasse: profile.fteKlasse,
            plaats: profile.plaats ?? null,
            provincie: profile.provincie ?? null,
            bestuursvorm: profile.bestuursvorm ?? null,
            oprichtingsdatum: profile.oprichtingsdatum ?? null,
            actief: profile.actief,
            last_updated_at: new Date().toISOString(),
          },
          { onConflict: "kvk" },
        );
      if (profile.bestuurders && profile.bestuurders.length > 0) {
        await upsertKvkBestuurders(supabase, profile.kvkNummer, profile.bestuurders);
      }
      refreshed.push("kvk_basisprofiel");
    }
  } catch (err) {
    console.warn(`[bulk-refresh] kvk_basisprofiel ${handle.kvk}: ${String(err)}`);
    failed.push("kvk_basisprofiel");
  }

  // Voor de website-scrape gebruiken we de net-resolved URL (bare-
  // domain prefer); valt terug op de handle-input als KvK basisprofiel
  // faalde of geen website had.
  const websiteUrl = resolvedSiteUrl ?? handle.websiteUrl ?? null;

  // 2. Per tool: live MCP-call → persistRaw met huidige schema-version.
  //    Plus deterministische upserts waar van toepassing (website →
  //    contacts via deriveContactsFromPages).
  for (const tool of TOOLS) {
    if (tool.needsWebsite && !websiteUrl) {
      continue; // sla over — geen website bekend
    }

    try {
      let payload: unknown = null;
      switch (tool.name) {
        case "get_company_website_content": {
          const r = await mcps.bedrijven.getCompanyWebsiteContent(ctx, {
            url: websiteUrl!,
            maxPages: 5,
          });
          payload = r;
          // Deterministische contacten (JSON-LD ContactPoint + mailto:/tel:)
          if (r.pages && r.pages.length > 0) {
            const contactRows: ContactInsert[] = deriveContactsFromPages(
              handle.kvk,
              r.pages,
            );
            if (contactRows.length > 0) {
              await upsertDeterministicContacts(supabase, contactRows);
            }
          }
          break;
        }
        case "extract_vacancies_from_company_site": {
          payload = await mcps.vacatures.extractVacanciesFromCompanySite(ctx, {
            url: websiteUrl!,
          });
          break;
        }
        case "search_court_cases": {
          if (zoeknamen.length === 0) continue;
          payload = await mcps.juridisch.searchCourtCases(ctx, {
            company_names: zoeknamen,
            legal_area: "Arbeidsrecht",
          });
          break;
        }
        case "search_labor_inspections": {
          payload = await mcps.juridisch.searchLaborInspections(ctx, {
            search_term: handle.naam,
          });
          break;
        }
        case "search_insolvencies": {
          if (zoeknamen.length === 0) continue;
          payload = await mcps.juridisch.searchInsolvencies(ctx, {
            company_names: zoeknamen,
          });
          break;
        }
        case "search_company_news": {
          payload = await mcps.news.searchCompanyNews(ctx, {
            company_name: handle.naam,
            max_results: 10,
          });
          break;
        }
      }

      if (payload != null) {
        await persistRaw(supabase, handle.kvk, tool.name, payload);
        refreshed.push(tool.name);
      }
    } catch (err) {
      console.warn(
        `[bulk-refresh] ${tool.name} ${handle.kvk}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed.push(tool.name);
    }
  }

  return {
    kvk: handle.kvk,
    toolsRefreshed: refreshed,
    toolsFailed: failed,
    durationMs: Date.now() - startedAt,
  };
}
