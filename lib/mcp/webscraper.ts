// Typed wrapper rond de mcp-webscraper HTTP-client. Eén methode per
// scraper-tool. Alle methodes retourneren RUWE data — interpretatie
// gebeurt in lib/classification/.

import { McpHttpClient, type TenantContext } from "./client";
import {
  WebsiteScrapeResult,
  RechtspraakRawResult,
  NlaRawResult,
  InsolventieRawResult,
  VacatureRawResult,
  NewsRawResult,
  type WebsiteScrapeResult as WebsiteScrapeResultT,
  type RechtspraakRawResult as RechtspraakRawResultT,
  type NlaRawResult as NlaRawResultT,
  type InsolventieRawResult as InsolventieRawResultT,
  type VacatureRawResult as VacatureRawResultT,
  type NewsRawResult as NewsRawResultT,
} from "./schemas";

export class WebscraperMcp {
  constructor(private readonly client: McpHttpClient) {}

  scrapeWebsite(
    ctx: TenantContext,
    args: { url: string; maxPages?: number },
  ): Promise<WebsiteScrapeResultT> {
    return this.client.callTool("scrape_website", ctx, args, WebsiteScrapeResult);
  }

  scrapeRechtspraak(
    ctx: TenantContext,
    args: { zoeknamen: string[]; rechtsgebied?: string },
  ): Promise<RechtspraakRawResultT> {
    return this.client.callTool(
      "scrape_rechtspraak",
      ctx,
      args,
      RechtspraakRawResult,
    );
  }

  scrapeNla(
    ctx: TenantContext,
    args: { zoekterm: string },
  ): Promise<NlaRawResultT> {
    return this.client.callTool("scrape_nla", ctx, args, NlaRawResult);
  }

  scrapeInsolventie(
    ctx: TenantContext,
    args: { zoeknamen: string[] },
  ): Promise<InsolventieRawResultT> {
    return this.client.callTool(
      "scrape_insolventie",
      ctx,
      args,
      InsolventieRawResult,
    );
  }

  scrapeVacatures(
    ctx: TenantContext,
    args: { url: string },
  ): Promise<VacatureRawResultT> {
    return this.client.callTool("scrape_vacatures", ctx, args, VacatureRawResult);
  }

  scrapeNews(
    ctx: TenantContext,
    args: { zoekterm: string; maxResults?: number },
  ): Promise<NewsRawResultT> {
    return this.client.callTool("scrape_news", ctx, args, NewsRawResult);
  }
}

export function requireWebscraperUrl(): string {
  const url = process.env.FACTUMAI_MCP_WEBSCRAPER_URL;
  if (!url) throw new Error("FACTUMAI_MCP_WEBSCRAPER_URL ontbreekt voor prod-mode.");
  return url;
}
