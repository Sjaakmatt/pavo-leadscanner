// Re-exports voor backwards-compat. De productie-flow gebruikt
// scrapeAndClassifyCompany en runScrapeBatch.
//
// (De vorige in-process orchestrator is vervangen door MCP-aanroepen;
// scrape-execution leeft nu in @factumai/mcp-webscraper.)

export { scrapeAndClassifyCompany } from "./scrape-and-classify";
export { runScrapeBatch } from "./run-batch";
export type { OrchestrationResult } from "./scrape-and-classify";
