// De 5 test-bedrijven voor alle scrapers.
// URLs handmatig geverifieerd door Sjaak (24 april 2026).

import type { TestCompany } from "./types.ts";

export const TEST_COMPANIES: TestCompany[] = [
  {
    id: "kuin",
    naam: "Kuin Aannemingsbedrijf",
    zoeknamen: ["Kuin Aannemingsbedrijf", "Aannemingsbedrijf Kuin", "Kuin B.V."],
    url: "https://kuinbv.nl",
    verwachteFte: 50,
    sector: "Bouw",
    cluster: 2,
    notitie: "West-Friese bouwer",
  },
  {
    id: "joz",
    naam: "JOZ",
    zoeknamen: ["JOZ B.V.", "JOZ Westwoud", "JOZ stalreiniging"],
    url: "https://joz.nl",
    verwachteFte: 95,
    sector: "Agri-tech productie",
    cluster: 2,
    notitie: "Machinebouwer voor veehouderij",
  },
  {
    id: "tpahga",
    naam: "TPAHG architecten",
    zoeknamen: ["TPAHG architecten", "TPAHG"],
    url: "https://www.tpahga.nl",
    verwachteFte: 23,
    sector: "Architectuur",
    cluster: 3,
    notitie: "Klein architectenbureau",
  },
  {
    id: "rolan",
    naam: "Rolan Robotics",
    zoeknamen: ["Rolan Robotics", "Rolan Robotics B.V."],
    url: "https://www.rolan-robotics.nl",
    verwachteFte: 33,
    sector: "Industriele automatisering",
    cluster: 1,
    notitie: "Robotica-bedrijf in Hoorn",
  },
  {
    id: "bercomex",
    naam: "Bercomex",
    zoeknamen: ["Bercomex", "Bercomex B.V."],
    url: "https://bercomex.com",
    verwachteFte: 78,
    sector: "Machineproductie",
    cluster: 2,
    notitie: "Machinebouwer voor bloembollensector",
  },
];
