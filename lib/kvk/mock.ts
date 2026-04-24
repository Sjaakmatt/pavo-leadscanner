// Mock KvK-client. Actief wanneer KVK_API_KEY ontbreekt of op
// "placeholder" staat, zodat Sjaak de productie-pijplijn end-to-end
// kan testen zonder Dataservice-abonnement.
//
// De mock genereert deterministische dummy-bedrijven op basis van
// SBI-codes + FTE-klasse + provincie, zodat dezelfde filters altijd
// dezelfde kandidaten opleveren. Namen en KvK-nummers zijn duidelijk
// herkenbaar als mock (prefix "MOCK-").

import type {
  KvkBasisprofiel,
  KvkZoekResult,
} from "./types";

// Pseudo-random op basis van seed — zelfde seed = zelfde output. Ter
// vermijding van crypto of de `seedrandom`-lib; we hebben maar licht
// randomness nodig.
function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededPick<T>(seed: string, arr: T[]): T {
  return arr[hashCode(seed) % arr.length];
}

const DEFAULT_PROVINCIES = [
  "Noord-Holland",
  "Zuid-Holland",
  "Utrecht",
  "Noord-Brabant",
  "Gelderland",
  "Overijssel",
  "Groningen",
  "Friesland",
];

const DEFAULT_FTE = ["10-19", "20-49", "50-99", "100-199"];

const MOCK_PLAATSEN: Record<string, string[]> = {
  "Noord-Holland": ["Amsterdam", "Hoorn", "Alkmaar", "Zaandam"],
  "Zuid-Holland": ["Rotterdam", "Den Haag", "Delft", "Leiden"],
  Utrecht: ["Utrecht", "Amersfoort", "Nieuwegein"],
  "Noord-Brabant": ["Eindhoven", "Breda", "Tilburg", "Den Bosch"],
  Gelderland: ["Nijmegen", "Arnhem", "Apeldoorn"],
  Overijssel: ["Enschede", "Zwolle", "Almelo"],
  Groningen: ["Groningen", "Hoogezand"],
  Friesland: ["Leeuwarden", "Sneek"],
};

const MOCK_NAAM_BOUW = ["Aannemersbedrijf", "Bouw", "Installatiebedrijf", "Dakdekkers", "Grondwerk"];
const MOCK_NAAM_PRODUCTIE = ["Industrie", "Machinebouw", "Metaalbewerking", "Fabriek", "Techniek"];
const MOCK_NAAM_LOGISTIEK = ["Transport", "Logistics", "Vervoer", "Expeditie"];
const MOCK_NAAM_ZAKELIJK = ["Advies", "Consultancy", "Adviseurs"];
const MOCK_NAAM_RETAIL = ["Retail", "Handel", "Shop", "Warenhuis"];

function sbiToNaamPool(sbi: string): string[] {
  const prefix = sbi.slice(0, 2);
  if (["41", "42", "43"].includes(prefix)) return MOCK_NAAM_BOUW;
  if (["10", "11", "12", "13", "14", "15", "16", "17", "18", "19",
    "20", "21", "22", "23", "24", "25", "26", "27", "28", "29",
    "30", "31", "32", "33"].includes(prefix)) return MOCK_NAAM_PRODUCTIE;
  if (["49", "50", "51", "52", "53"].includes(prefix)) return MOCK_NAAM_LOGISTIEK;
  if (["69", "70", "71", "72", "73", "74", "78", "82"].includes(prefix)) return MOCK_NAAM_ZAKELIJK;
  return MOCK_NAAM_RETAIL;
}

const ACHTERNAMEN = [
  "Jansen", "De Vries", "Van den Berg", "Bakker", "Visser",
  "Smit", "Meijer", "De Jong", "Mulder", "De Boer",
  "Hendriks", "Van Dijk", "Peters", "Willems", "Scholten",
];

// Generates a stable fake KvK — 8 digits prefixed with "9" so they never
// collide with real numbers (real KvK-nummers start 0-8 historically).
function fakeKvkFor(seed: string): string {
  const n = hashCode(seed).toString().padStart(7, "0").slice(0, 7);
  return `9${n}`;
}

export function kvkZoekBedrijvenMock(params: {
  sbiCodes: string[];
  provincies?: string[];
  fteKlassen?: string[];
  limit?: number;
}): KvkZoekResult[] {
  const limit = params.limit ?? 100;
  const sbis = params.sbiCodes.length > 0 ? params.sbiCodes : ["00"];
  const provincies = params.provincies?.length
    ? params.provincies
    : DEFAULT_PROVINCIES;

  const out: KvkZoekResult[] = [];
  let i = 0;
  // Deterministic loop: one candidate per (sbi, provincie, iterator).
  outer: for (const sbi of sbis) {
    for (const prov of provincies) {
      for (let k = 0; k < 8; k++) {
        const seed = `${sbi}-${prov}-${k}`;
        const naamPool = sbiToNaamPool(sbi);
        const achternaam = seededPick(seed, ACHTERNAMEN);
        const bedrijfsType = seededPick(seed, naamPool);
        const naam = `${achternaam} ${bedrijfsType} B.V.`;
        const plaats = seededPick(seed, MOCK_PLAATSEN[prov] ?? ["Amsterdam"]);
        out.push({
          kvkNummer: fakeKvkFor(seed),
          handelsnaam: naam,
          statutaireNaam: naam,
          sbiCodes: [sbi],
          vestigingsnummer: `${fakeKvkFor(seed)}0001`,
          provincie: prov,
          plaats,
          indicatieHoofdvestiging: true,
        });
        i += 1;
        if (i >= limit) break outer;
      }
    }
  }
  return out;
}

export function kvkGetBasisprofielMock(kvk: string): KvkBasisprofiel {
  const fte = DEFAULT_FTE[hashCode(kvk) % DEFAULT_FTE.length];
  const prov = DEFAULT_PROVINCIES[hashCode(kvk) % DEFAULT_PROVINCIES.length];
  const plaats = (MOCK_PLAATSEN[prov] ?? ["Amsterdam"])[hashCode(kvk) % 3];
  const naam = `MOCK ${ACHTERNAMEN[hashCode(kvk) % ACHTERNAMEN.length]} B.V.`;
  return {
    kvkNummer: kvk,
    naam,
    handelsnaam: naam,
    websiteUrl: `https://www.mock-${kvk}.nl`,
    sbiCodes: ["41.10"],
    fteKlasse: fte as KvkBasisprofiel["fteKlasse"],
    bestuursvorm: "besloten vennootschap",
    oprichtingsdatum: "2015-06-01",
    actief: true,
    bestuurders: [
      { naam: "Jan Jansen", functie: "Directeur", sinds: "2015-06-01" },
    ],
    vestigingen: [
      {
        vestigingsnummer: `${kvk}0001`,
        isHoofdvestiging: true,
        handelsnaam: naam,
        adres: "Industrieweg 1",
        plaats,
        provincie: prov,
      },
    ],
    provincie: prov,
    plaats,
    raw: { mock: true, kvk },
  };
}
