// LeadSource-adapter. De API routes praten uitsluitend tegen deze module
// — `getLeadSource()` beslist op runtime welke implementatie.
//
//   MODE=demo (of ongezet)  →  MockLeadSource (huidige leads.json flow)
//   MODE=prod               →  ProductionLeadSource (KvK + scrapers + scoring)
//
// Switchen gebeurt per-request op basis van process.env.MODE. De demo
// werkt dus zonder enige config; prod vereist KVK + Supabase env vars.

import { mockLeadSource } from "@/lib/adapters/mock";
import type { LeadSource } from "@/lib/adapters/types";
import { ProductionLeadSource } from "./production";

export type Mode = "demo" | "prod";

export function currentMode(): Mode {
  const raw = (process.env.MODE ?? "demo").toLowerCase();
  return raw === "prod" ? "prod" : "demo";
}

let cachedProd: ProductionLeadSource | null = null;

export function getLeadSource(): LeadSource {
  if (currentMode() === "prod") {
    cachedProd ??= new ProductionLeadSource();
    return cachedProd;
  }
  return mockLeadSource;
}

export { ProductionLeadSource } from "./production";
