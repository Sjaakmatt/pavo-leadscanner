// Typed wrapper rond mcp-vacatures. Eén tool: vacancy-extractie via
// sitemap + JSON-LD + ATS-widgets. Output is RUWE data — interpretatie
// gebeurt in lib/classification/.

import { McpHttpClient, type TenantContext } from "./client";
import {
  VacatureRawResult,
  type VacatureRawResult as VacatureRawResultT,
} from "./schemas";

export class VacaturesMcp {
  constructor(private readonly client: McpHttpClient) {}

  extractVacanciesFromCompanySite(
    ctx: TenantContext,
    args: { url: string },
  ): Promise<VacatureRawResultT> {
    return this.client.callTool(
      "extract_vacancies_from_company_site",
      ctx,
      args,
      VacatureRawResult,
    );
  }
}

export function requireVacaturesUrl(): string {
  const url = process.env.FACTUMAI_MCP_VACATURES_URL;
  if (!url) throw new Error("FACTUMAI_MCP_VACATURES_URL ontbreekt voor prod-mode.");
  return url;
}
