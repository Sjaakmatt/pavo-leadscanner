// Typed wrapper rond de mcp-bedrijven HTTP-client. Eén methode per
// MCP-tool; teruggegeven types komen uit lib/mcp/schemas.ts en zijn
// runtime-gevalideerd via zod.
//
// Cost-tracking: elke succesvolle call wordt automatisch geboekt op de
// CostTracker via currentScope(). Zoeken is gratis (€0), basisprofiel/
// vestigingsprofiel/naamgeving zijn €0.02. Geen-scope (bv. één-off
// scripts) → silent no-op.

import { z } from "zod";
import { McpHttpClient, type TenantContext } from "./client";
import {
  KvkZoekHit,
  KvkBasisprofiel,
  Geocode,
  KvkSnapshot,
  WebsiteScrapeResult,
  type KvkZoekHit as KvkZoekHitT,
  type KvkBasisprofiel as KvkBasisprofielT,
  type Geocode as GeocodeT,
  type KvkSnapshot as KvkSnapshotT,
  type WebsiteScrapeResult as WebsiteScrapeResultT,
} from "./schemas";
import { currentScope } from "@/lib/classification/cost";

function trackKvkCall(toolName: string): void {
  const scope = currentScope();
  scope?.tracker.recordKvkCall(toolName);
}

export class BedrijvenMcp {
  constructor(private readonly client: McpHttpClient) {}

  async kvkZoeken(
    ctx: TenantContext,
    args: {
      plaatsen: string[];
      type?: "hoofdvestiging" | "nevenvestiging" | "rechtspersoon";
      naam?: string;
      inclusiefInactief?: boolean;
      limit?: number;
    },
  ): Promise<KvkZoekHitT[]> {
    const result = await this.client.callTool("kvk_zoeken", ctx, args, z.array(KvkZoekHit));
    trackKvkCall("kvk_zoeken");
    return result;
  }

  async kvkBasisprofiel(
    ctx: TenantContext,
    kvk: string,
  ): Promise<KvkBasisprofielT | null> {
    const result = await this.client.callTool(
      "kvk_basisprofiel",
      ctx,
      { kvk },
      KvkBasisprofiel.nullable(),
    );
    // Track ook null-resultaten (404's) — die kosten alsnog een call.
    trackKvkCall("kvk_basisprofiel");
    return result;
  }

  async pdokGeocode(
    ctx: TenantContext,
    plaats: string,
  ): Promise<GeocodeT | null> {
    const result = await this.client.callTool(
      "pdok_geocode",
      ctx,
      { plaats },
      Geocode.nullable(),
    );
    trackKvkCall("pdok_geocode");
    return result;
  }

  async kvkHistorieSnapshot(
    ctx: TenantContext,
    kvk: string,
  ): Promise<KvkSnapshotT> {
    const result = await this.client.callTool(
      "kvk_historie_snapshot",
      ctx,
      { kvk },
      KvkSnapshot,
    );
    trackKvkCall("kvk_historie_snapshot");
    return result;
  }

  async getCompanyWebsiteContent(
    ctx: TenantContext,
    args: { url: string; maxPages?: number },
  ): Promise<WebsiteScrapeResultT> {
    const result = await this.client.callTool(
      "get_company_website_content",
      ctx,
      args,
      WebsiteScrapeResult,
    );
    trackKvkCall("get_company_website_content");
    return result;
  }
}

export function requireBedrijvenUrl(): string {
  const url = process.env.FACTUMAI_MCP_BEDRIJVEN_URL;
  if (!url) throw new Error("FACTUMAI_MCP_BEDRIJVEN_URL ontbreekt voor prod-mode.");
  return url;
}
