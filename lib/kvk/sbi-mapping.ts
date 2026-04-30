// Branche ↔ SBI-code mapping. De UI toont mens-leesbare branches; KvK's
// zoek-API verwacht SBI-codes (2-cijferig prefix werkt; KvK matcht op
// prefix). We houden de lijst in sync met de filter-labels uit de UI.
//
// De BRANCHE_TO_SEARCH_ID-mapping in lib/adapters/mock.ts gebruikt
// identieke labels — als je een nieuwe branche toevoegt, voeg hem hier
// én daar toe.

// Branches zoals ze in de UI-filter verschijnen (zie FilterBar.tsx).
export const BRANCHE_LABELS = [
  "Bouw & installatie",
  "Logistiek & transport",
  "Zakelijke dienstverlening",
  "Productie & techniek",
  "Retail & e-commerce",
] as const;

export type BrancheLabel = (typeof BRANCHE_LABELS)[number];

// SBI-prefixes per branche. Gebruik 2-cijferig prefix; KvK's filter
// matcht op `startsWith`, dus "41" matcht ook "41.10", "41.20" etc.
export const BRANCHE_TO_SBI: Record<BrancheLabel, string[]> = {
  "Bouw & installatie": ["41", "42", "43"],
  "Logistiek & transport": ["49", "50", "51", "52", "53"],
  "Zakelijke dienstverlening": ["69", "70", "71", "72", "73", "74", "78", "82"],
  // Productie & techniek: alle secties C (manufacturing, SBI 10-33).
  "Productie & techniek": [
    "10", "11", "12", "13", "14", "15", "16", "17", "18", "19",
    "20", "21", "22", "23", "24", "25", "26", "27", "28", "29",
    "30", "31", "32", "33",
  ],
  "Retail & e-commerce": ["45", "46", "47"],
};

export function mapBrancheToSbi(branche: string): string[] {
  if (!branche || branche === "Alle branches" || branche === "alle") {
    // "Alle branches" = geen SBI-filter. Vroeger retourneerde we de unie
    // van alle CONFIGUREERDE prefixes (~40 codes), maar dat sloot
    // bedrijven uit niet-geconfigureerde branches uit (kappers SBI 96,
    // horeca 56, zorg 86, etc.). Lege array betekent voor de filter
    // 'no-op' — alle SBI-codes passeren.
    return [];
  }
  const hit = BRANCHE_TO_SBI[branche as BrancheLabel];
  return hit ?? [];
}
