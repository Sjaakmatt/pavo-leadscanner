// Typed wrapper rond mcp-news. Eén tool: bedrijfsnieuws via Google
// News RSS. Output is RUWE data — interpretatie gebeurt in
// lib/classification/.

import { McpHttpClient, type TenantContext } from "./client";
import {
  NewsRawResult,
  type NewsRawResult as NewsRawResultT,
} from "./schemas";

export class NewsMcp {
  constructor(private readonly client: McpHttpClient) {}

  // Liever `company_names` doorgeven (statutaire naam + handelsnamen)
  // dan een enkele `company_name`: KvK levert vaak een ander statutair
  // label dan waar het bedrijf publiekelijk onder bekend staat, dus de
  // multi-name query verhoogt recall fors.
  searchCompanyNews(
    ctx: TenantContext,
    args: { company_names: string[]; max_results?: number },
  ): Promise<NewsRawResultT> {
    return this.client.callTool(
      "search_company_news",
      ctx,
      args,
      NewsRawResult,
    );
  }
}

export function requireNewsUrl(): string {
  const url = process.env.FACTUMAI_MCP_NEWS_URL;
  if (!url) throw new Error("FACTUMAI_MCP_NEWS_URL ontbreekt voor prod-mode.");
  return url;
}
