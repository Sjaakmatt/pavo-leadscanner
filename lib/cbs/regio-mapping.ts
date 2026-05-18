// Provincie/COROP/arbeidsmarktregio → CBS regio-codes voor de
// spanningsindicator (krapte arbeidsmarkt).
//
// CBS gebruikt verschillende regio-indelingen. Voor PAVO is de
// "Arbeidsmarktregio" (35 stuks landelijk) het meest praktisch — die
// matchen ongeveer met de UWV-werkbedrijfregio's die HR-mensen kennen.
//
// We mappen provincie → standaard arbeidsmarktregio (de centrale stad).
// Fijner detail (per gemeente) is mogelijk maar voegt voor lead-context
// weinig toe.

export interface CbsRegio {
  /** Provincie-code (PV20-30) */
  provincieCode: string;
  /** Provincie-naam */
  provincie: string;
  /** Arbeidsmarktregio-code (AM01-AM35) */
  arbeidsmarktregioCode: string;
  /** Arbeidsmarktregio-naam */
  arbeidsmarktregio: string;
}

const PROVINCIES: CbsRegio[] = [
  {
    provincieCode: "PV20",
    provincie: "Groningen",
    arbeidsmarktregioCode: "AM01",
    arbeidsmarktregio: "Groningen",
  },
  {
    provincieCode: "PV21",
    provincie: "Friesland",
    arbeidsmarktregioCode: "AM02",
    arbeidsmarktregio: "Friesland",
  },
  {
    provincieCode: "PV22",
    provincie: "Drenthe",
    arbeidsmarktregioCode: "AM04",
    arbeidsmarktregio: "Drenthe",
  },
  {
    provincieCode: "PV23",
    provincie: "Overijssel",
    arbeidsmarktregioCode: "AM07",
    arbeidsmarktregio: "Twente",
  },
  {
    provincieCode: "PV24",
    provincie: "Flevoland",
    arbeidsmarktregioCode: "AM10",
    arbeidsmarktregio: "Flevoland",
  },
  {
    provincieCode: "PV25",
    provincie: "Gelderland",
    arbeidsmarktregioCode: "AM11",
    arbeidsmarktregio: "Midden-Gelderland",
  },
  {
    provincieCode: "PV26",
    provincie: "Utrecht",
    arbeidsmarktregioCode: "AM15",
    arbeidsmarktregio: "Midden-Utrecht",
  },
  {
    provincieCode: "PV27",
    provincie: "Noord-Holland",
    arbeidsmarktregioCode: "AM18",
    arbeidsmarktregio: "Groot Amsterdam",
  },
  {
    provincieCode: "PV28",
    provincie: "Zuid-Holland",
    arbeidsmarktregioCode: "AM23",
    arbeidsmarktregio: "Rijnmond",
  },
  {
    provincieCode: "PV29",
    provincie: "Zeeland",
    arbeidsmarktregioCode: "AM26",
    arbeidsmarktregio: "Zeeland",
  },
  {
    provincieCode: "PV30",
    provincie: "Noord-Brabant",
    arbeidsmarktregioCode: "AM27",
    arbeidsmarktregio: "Midden-Brabant",
  },
  {
    provincieCode: "PV31",
    provincie: "Limburg",
    arbeidsmarktregioCode: "AM33",
    arbeidsmarktregio: "Zuid-Limburg",
  },
];

const NEDERLAND: CbsRegio = {
  provincieCode: "NL01",
  provincie: "Nederland",
  arbeidsmarktregioCode: "NL01",
  arbeidsmarktregio: "Nederland",
};

/**
 * Vind CBS-regio op basis van vrij-tekst provincie-naam (zoals KvK
 * basisprofiel teruggeeft, bv. "Noord-Holland", "Zuid-Holland").
 * Case-insensitive, accent-tolerant.
 */
export function provincieNaarRegio(provincie: string | null | undefined): CbsRegio {
  if (!provincie) return NEDERLAND;
  const norm = provincie.toLowerCase().trim();
  return (
    PROVINCIES.find((p) => p.provincie.toLowerCase() === norm) ?? NEDERLAND
  );
}

export const NEDERLAND_REGIO = NEDERLAND;
