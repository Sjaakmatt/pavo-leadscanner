// SBI-prefix → CBS Bedrijfstak-code mapping. CBS gebruikt eigen
// codes voor bedrijfstakken (BedrijfstakkenSBI2008-dimensie), niet
// directe SBI-codes. Mapping is op SBI-sectieletter (A-U) niveau —
// fijner detail (per branche) varieert per dataset, dus we houden 't
// op sectie-niveau wat voor PAVO-branches al genoeg signaal geeft.
//
// Bron: opendata.cbs.nl/ODataApi/odata/{tableId}/BedrijfstakkenSBI2008
// (de exacte codes verschillen soms per dataset; deze waardes komen
// van 80072NED ziekteverzuim).

export interface CbsBedrijfstak {
  /** SBI-sectie (eerste letter van SBI-code) */
  sectie: string;
  /** Volledige naam */
  naam: string;
  /** CBS-code in BedrijfstakkenSBI2008 */
  code: string;
}

const BEDRIJFSTAKKEN: CbsBedrijfstak[] = [
  { sectie: "A", naam: "Landbouw, bosbouw en visserij", code: "300006" },
  { sectie: "B", naam: "Delfstoffenwinning", code: "300007" },
  { sectie: "C", naam: "Industrie", code: "300008" },
  { sectie: "D", naam: "Energievoorziening", code: "300009" },
  { sectie: "E", naam: "Waterbedrijven en afvalbeheer", code: "T001140" },
  { sectie: "F", naam: "Bouwnijverheid", code: "T001141" },
  { sectie: "G", naam: "Handel", code: "300010" },
  { sectie: "H", naam: "Vervoer en opslag", code: "300011" },
  { sectie: "I", naam: "Horeca", code: "300012" },
  { sectie: "J", naam: "Informatie en communicatie", code: "300013" },
  { sectie: "K", naam: "Financiële dienstverlening", code: "300014" },
  { sectie: "L", naam: "Verhuur en handel onroerend goed", code: "300015" },
  { sectie: "M", naam: "Specialistische zakelijke diensten", code: "300016" },
  { sectie: "N", naam: "Verhuur en overige zakelijke diensten", code: "300017" },
  { sectie: "O", naam: "Openbaar bestuur en overheidsdiensten", code: "300018" },
  { sectie: "P", naam: "Onderwijs", code: "300019" },
  { sectie: "Q", naam: "Gezondheids- en welzijnszorg", code: "300020" },
  { sectie: "R", naam: "Cultuur, sport en recreatie", code: "300021" },
  { sectie: "S", naam: "Overige dienstverlening", code: "300022" },
];

const ALLE_BEDRIJFSTAKKEN: CbsBedrijfstak = {
  sectie: "*",
  naam: "Alle bedrijfstakken",
  code: "T001081",
};

/**
 * Vind de CBS-bedrijfstak voor een SBI-code. SBI is numeriek
 * (bv. "41201" voor "Bouw van woningen"), wij mappen op de eerste
 * 2 cijfers via de SBI-sectieletter-tabel.
 *
 * Fallback: "alle bedrijfstakken" wanneer mapping faalt.
 */
export function sbiToBedrijfstak(sbiCode: string | null | undefined): CbsBedrijfstak {
  if (!sbiCode) return ALLE_BEDRIJFSTAKKEN;
  const sectie = sbiSectie(sbiCode);
  if (!sectie) return ALLE_BEDRIJFSTAKKEN;
  return BEDRIJFSTAKKEN.find((b) => b.sectie === sectie) ?? ALLE_BEDRIJFSTAKKEN;
}

/**
 * Bepaal de SBI-sectieletter (A-U) op basis van de eerste 2 cijfers
 * van een SBI-code. Deze mapping volgt SBI 2008 standaard.
 */
function sbiSectie(sbi: string): string | null {
  const num = Number.parseInt(sbi.slice(0, 2), 10);
  if (Number.isNaN(num)) return null;
  if (num >= 1 && num <= 3) return "A";
  if (num >= 5 && num <= 9) return "B";
  if (num >= 10 && num <= 33) return "C";
  if (num === 35) return "D";
  if (num >= 36 && num <= 39) return "E";
  if (num >= 41 && num <= 43) return "F";
  if (num >= 45 && num <= 47) return "G";
  if (num >= 49 && num <= 53) return "H";
  if (num === 55 || num === 56) return "I";
  if (num >= 58 && num <= 63) return "J";
  if (num >= 64 && num <= 66) return "K";
  if (num === 68) return "L";
  if (num >= 69 && num <= 75) return "M";
  if (num >= 77 && num <= 82) return "N";
  if (num === 84) return "O";
  if (num === 85) return "P";
  if (num >= 86 && num <= 88) return "Q";
  if (num >= 90 && num <= 93) return "R";
  if (num >= 94 && num <= 96) return "S";
  return null;
}

export const ALLE = ALLE_BEDRIJFSTAKKEN;
