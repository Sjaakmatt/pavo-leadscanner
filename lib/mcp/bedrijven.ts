// Typed wrapper rond de mcp-bedrijven HTTP-client. Eén methode per
// MCP-tool; teruggegeven types komen uit lib/mcp/schemas.ts en zijn
// runtime-gevalideerd via zod.

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

export class BedrijvenMcp {
  constructor(private readonly client: McpHttpClient) {}

  async kvkZoeken(
    ctx: TenantContext,
    args: { sbiCodes: string[]; provincies?: string[]; limit?: number },
  ): Promise<KvkZoekHitT[]> {
    return this.client.callTool("kvk_zoeken", ctx, args, z.array(KvkZoekHit));
  }

  async kvkBasisprofiel(
    ctx: TenantContext,
    kvk: string,
  ): Promise<KvkBasisprofielT | null> {
    return this.client.callTool(
      "kvk_basisprofiel",
      ctx,
      { kvk },
      KvkBasisprofiel.nullable(),
    );
  }

  async pdokGeocode(
    ctx: TenantContext,
    plaats: string,
  ): Promise<GeocodeT | null> {
    return this.client.callTool(
      "pdok_geocode",
      ctx,
      { plaats },
      Geocode.nullable(),
    );
  }

  async kvkHistorieSnapshot(
    ctx: TenantContext,
    kvk: string,
  ): Promise<KvkSnapshotT> {
    return this.client.callTool("kvk_historie_snapshot", ctx, { kvk }, KvkSnapshot);
  }

  async getCompanyWebsiteContent(
    ctx: TenantContext,
    args: { url: string; maxPages?: number },
  ): Promise<WebsiteScrapeResultT> {
    return this.client.callTool(
      "get_company_website_content",
      ctx,
      args,
      WebsiteScrapeResult,
    );
  }
}

export function requireBedrijvenUrl(): string {
  const url = process.env.FACTUMAI_MCP_BEDRIJVEN_URL;
  if (!url) throw new Error("FACTUMAI_MCP_BEDRIJVEN_URL ontbreekt voor prod-mode.");
  return url;
}
