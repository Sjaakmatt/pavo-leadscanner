// Per-tool schema-version registratie. Wordt mee-geschreven naar
// mcp_raw_responses.schema_version bij elke succesvolle MCP-call, en
// bij de read-kant gebruikt om stale-schema-cache te invalideren.
//
// **Wanneer bumpen?** Bij elke verandering aan een MCP-tool die ervoor
// zorgt dat oude cached responses incomplete data bevatten:
//   - Nieuwe veld toegevoegd dat consumer nodig heeft (bv. contactPoints)
//   - Endpoint-fix waardoor data nu wel correct binnenkomt
//   - Filter-aanpassing die andere rijen oplevert
//
// **Wanneer NIET bumpen?** Pure performance-fixes, refactors zonder
// schema-impact, of als oude data nog gewoon bruikbaar is.
//
// Versies starten op 1 voor de "klaar"-toestand; default 0 in DB
// betekent "uit pre-versioning tijdperk" en wordt altijd ververst.

export const TOOL_SCHEMA_VERSIONS: Record<string, number> = {
  // v2 = ScrapedPage.contactPoints + contactLinks toegevoegd (mei 2026)
  get_company_website_content: 2,

  // v1 = Recruitee 3-staps fallback + Greenhouse/Lever/Personio + sitemap
  extract_vacancies_from_company_site: 1,

  // v1 = HR-relevant rechtsgebied filter + naam-match (mei 2026)
  search_court_cases: 1,

  // v2 = /api/inspecties endpoint + dedupe op type binnen inspectie (mei 2026)
  search_labor_inspections: 2,

  // v2 = Werkende CSRF-flow naar Centraal Insolventieregister (mei 2026)
  search_insolvencies: 2,

  // v1 = Google News tracker URL decoder
  search_company_news: 1,
};

export function currentSchemaVersion(tool: string): number {
  return TOOL_SCHEMA_VERSIONS[tool] ?? 0;
}

export function isCacheVersionStale(tool: string, cachedVersion: number): boolean {
  return cachedVersion < currentSchemaVersion(tool);
}
