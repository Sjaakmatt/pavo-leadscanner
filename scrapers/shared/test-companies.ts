import type { TestCompany } from "./types.ts";

// Seed list of 5 validated MKB-companies. Kept as anchor set: every time
// the generator produces a fresh batch of 50, these 5 stay as regression
// anchors so we can detect drift between runs.
//
// Run `npm run generate:test-companies` to append 45 more via Claude +
// web_search. Generated entries land in this same array.
export const TEST_COMPANIES: TestCompany[] = [
  {
    id: "kuin",
    naam: "Kuin B.V.",
    url: "https://www.kuin.nl",
    kvk: "37084234",
    verwachteFte: 80,
    sector: "bouw/infra",
  },
  {
    id: "vdberg-infra",
    naam: "Van den Berg Infrastructuren B.V.",
    url: "https://www.vdberginfra.nl",
    kvk: "36011370",
    verwachteFte: 110,
    sector: "bouw/infra",
  },
  {
    id: "hemmink",
    naam: "Hemmink B.V.",
    url: "https://www.hemmink.nl",
    kvk: "05024050",
    verwachteFte: 60,
    sector: "productie/techniek",
  },
  {
    id: "koopmanlogistics",
    naam: "Koopman Logistics Group",
    url: "https://www.koopman.com",
    kvk: "01037370",
    verwachteFte: 90,
    sector: "transport/logistiek",
  },
  {
    id: "buko",
    naam: "Buko Groep",
    url: "https://www.buko.nl",
    kvk: "37061910",
    verwachteFte: 120,
    sector: "bouw/infra",
  },
];
