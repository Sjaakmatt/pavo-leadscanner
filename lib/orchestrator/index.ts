// Re-exports voor backwards-compat. De productie-flow gebruikt
// scrapeAndClassifyCompany en runScrapeBatch.
//
// Scrape-execution leeft in vier domein-MCPs: mcp-bedrijven (website),
// mcp-vacatures, mcp-juridisch (rechtspraak/NLA/insolventie), mcp-news.

export { scrapeAndClassifyCompany } from "./scrape-and-classify";
export { runScrapeBatch } from "./run-batch";
export type {
  OrchestrationResult,
  ScrapeMcps,
} from "./scrape-and-classify";
