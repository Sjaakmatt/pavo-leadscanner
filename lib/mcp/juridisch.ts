// Typed wrapper rond mcp-juridisch. Drie tools:
//   - search_court_cases       — Rechtspraak.nl via XML
//   - search_labor_inspections — NLA (stub: lege resultaten tot Playwright-adapter)
//   - search_insolvencies      — Insolventieregister (stub: idem)
//
// Output is RUWE data — interpretatie gebeurt in lib/classification/.

import { McpHttpClient, type TenantContext } from "./client";
import {
  RechtspraakRawResult,
  NlaRawResult,
  InsolventieRawResult,
  type RechtspraakRawResult as RechtspraakRawResultT,
  type NlaRawResult as NlaRawResultT,
  type InsolventieRawResult as InsolventieRawResultT,
} from "./schemas";

export class JuridischMcp {
  constructor(private readonly client: McpHttpClient) {}

  searchCourtCases(
    ctx: TenantContext,
    args: { company_names: string[]; legal_area?: string },
  ): Promise<RechtspraakRawResultT> {
    return this.client.callTool(
      "search_court_cases",
      ctx,
      args,
      RechtspraakRawResult,
    );
  }

  searchLaborInspections(
    ctx: TenantContext,
    args: { search_term: string },
  ): Promise<NlaRawResultT> {
    return this.client.callTool(
      "search_labor_inspections",
      ctx,
      args,
      NlaRawResult,
    );
  }

  searchInsolvencies(
    ctx: TenantContext,
    args: { company_names: string[] },
  ): Promise<InsolventieRawResultT> {
    return this.client.callTool(
      "search_insolvencies",
      ctx,
      args,
      InsolventieRawResult,
    );
  }
}

export function requireJuridischUrl(): string {
  const url = process.env.FACTUMAI_MCP_JURIDISCH_URL;
  if (!url) throw new Error("FACTUMAI_MCP_JURIDISCH_URL ontbreekt voor prod-mode.");
  return url;
}
