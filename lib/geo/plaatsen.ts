// Plaatsen-lookup voor de KvK Zoeken-flow. We hebben een lijst plaats-
// namen + WGS84-centroids nodig om vóór de KvK-call te bepalen welke
// plaatsen binnen `radiusKm` van het search-center vallen.
//
// Strategie:
//   1. Bij eerste call: laad alle ~2500 NL-woonplaatsen uit PDOK
//      Locatieserver. Eén HTTP-call, gecached voor de levensduur van het
//      Node-proces (Vercel-lambda).
//   2. Fallback: statische curated lijst (~150 plaatsen) als PDOK faalt
//      of niet bereikbaar is. Dekt minimaal de Randstad + grote steden
//      zodat een search nooit volledig leeg uitvalt.
//   3. Toekomstige caches kunnen de result naar Supabase stikken zodat
//      meerdere lambda-instances 'm kunnen delen — voor nu in-memory
//      per-instance is goed genoeg gezien <500ms PDOK-fetch.

import { haversineKm, type LatLng } from "./pdok";

export type PlaatsRecord = { naam: string; coords: LatLng };

const PDOK_SEARCH_URL = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";

let plaatsenCache: Promise<ReadonlyArray<PlaatsRecord>> | null = null;

async function loadAllPlaatsen(): Promise<ReadonlyArray<PlaatsRecord>> {
  if (plaatsenCache) return plaatsenCache;
  plaatsenCache = (async () => {
    try {
      // PDOK Locatieserver accepteert max 100 rows per page; we pagineren
      // tot we leeg terugkomen of de safety-cap raken. Solr `q=*:*` matcht
      // alles; `fq=type:woonplaats` filtert tot woonplaatsen (geen
      // gemeenten/wijken/postcodes).
      const PAGE_SIZE = 100;
      const MAX_PAGES = 40; // ~4000 woonplaatsen safety cap (NL heeft ~2500)
      const out: PlaatsRecord[] = [];
      const seen = new Set<string>();
      for (let page = 0; page < MAX_PAGES; page++) {
        const url =
          `${PDOK_SEARCH_URL}?q=*:*&fq=type:woonplaats&rows=${PAGE_SIZE}` +
          `&start=${page * PAGE_SIZE}&fl=woonplaatsnaam,centroide_ll`;
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) {
          console.warn(
            `[plaatsen] PDOK page ${page} returned ${res.status} — stopping pagination at ${out.length}`,
          );
          break;
        }
        const json = (await res.json()) as {
          response?: {
            docs?: Array<{ woonplaatsnaam?: string; centroide_ll?: string }>;
          };
        };
        const docs = json.response?.docs ?? [];
        if (docs.length === 0) break; // klaar
        for (const d of docs) {
          const naam = d.woonplaatsnaam;
          const wkt = d.centroide_ll;
          if (!naam || !wkt) continue;
          const m = wkt.match(/POINT\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/);
          if (!m) continue;
          const lng = parseFloat(m[1]);
          const lat = parseFloat(m[2]);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          const key = naam.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ naam, coords: { lat, lng } });
        }
        if (docs.length < PAGE_SIZE) break; // laatste pagina
      }
      if (out.length < 100) {
        console.warn(
          `[plaatsen] PDOK gaf maar ${out.length} woonplaatsen → fallback to static list`,
        );
        return PLAATSEN_STATIC;
      }
      console.log(`[plaatsen] loaded ${out.length} woonplaatsen from PDOK`);
      return out;
    } catch (err) {
      console.warn(`[plaatsen] PDOK fetch failed: ${String(err)} → fallback to static list`);
      return PLAATSEN_STATIC;
    }
  })();
  return plaatsenCache;
}

/**
 * Static fallback list — ~150 grootste NL-plaatsen. Wordt alleen gebruikt
 * als PDOK bereikbaar is maar geen data teruggeeft, of als PDOK een fout
 * gooit. Niet bedoeld als primaire bron — PDOK is dat.
 */
// Volgorde irrelevant; haversine-filter sorteert toch.
const PLAATSEN_STATIC: ReadonlyArray<PlaatsRecord> = [
  // Randstad — Noord-Holland
  { naam: "Amsterdam", coords: { lat: 52.3676, lng: 4.9041 } },
  { naam: "Haarlem", coords: { lat: 52.3874, lng: 4.6462 } },
  { naam: "Zaandam", coords: { lat: 52.4391, lng: 4.829 } },
  { naam: "Hoofddorp", coords: { lat: 52.3061, lng: 4.6907 } },
  { naam: "Amstelveen", coords: { lat: 52.3081, lng: 4.872 } },
  { naam: "Hilversum", coords: { lat: 52.2292, lng: 5.1669 } },
  { naam: "Alkmaar", coords: { lat: 52.6324, lng: 4.7534 } },
  { naam: "Heerhugowaard", coords: { lat: 52.6717, lng: 4.838 } },
  { naam: "Hoorn", coords: { lat: 52.6425, lng: 5.0597 } },
  { naam: "Purmerend", coords: { lat: 52.5051, lng: 4.9596 } },
  { naam: "Den Helder", coords: { lat: 52.9559, lng: 4.7611 } },
  { naam: "Velsen", coords: { lat: 52.4596, lng: 4.6561 } },
  { naam: "Beverwijk", coords: { lat: 52.4861, lng: 4.6561 } },
  { naam: "IJmuiden", coords: { lat: 52.4607, lng: 4.6122 } },
  // West-Friesland (Noord-Holland) — kleine plaatsen die we eerder misten.
  // (Stede Broec is een gemeente i.p.v. woonplaats — KvK kent 'm niet,
  // dus weggelaten. De woonplaatsen Bovenkarspel/Grootebroek/Lutjebroek
  // staan apart.)
  { naam: "Enkhuizen", coords: { lat: 52.7019, lng: 5.2906 } },
  { naam: "Medemblik", coords: { lat: 52.7708, lng: 5.1056 } },
  { naam: "Schagen", coords: { lat: 52.7872, lng: 4.7972 } },
  { naam: "Bovenkarspel", coords: { lat: 52.7167, lng: 5.2289 } },
  { naam: "Grootebroek", coords: { lat: 52.7117, lng: 5.2036 } },
  { naam: "Lutjebroek", coords: { lat: 52.7236, lng: 5.2122 } },
  { naam: "Andijk", coords: { lat: 52.7456, lng: 5.1844 } },
  { naam: "Wervershoof", coords: { lat: 52.7311, lng: 5.1503 } },
  { naam: "Wieringerwerf", coords: { lat: 52.8403, lng: 5.0394 } },
  { naam: "Hippolytushoef", coords: { lat: 52.9008, lng: 4.9569 } },
  { naam: "Anna Paulowna", coords: { lat: 52.8722, lng: 4.8631 } },
  { naam: "Den Burg", coords: { lat: 53.0517, lng: 4.7944 } },
  { naam: "Volendam", coords: { lat: 52.4944, lng: 5.0728 } },
  { naam: "Edam", coords: { lat: 52.5117, lng: 5.0436 } },
  { naam: "Monnickendam", coords: { lat: 52.4583, lng: 5.0411 } },
  { naam: "Castricum", coords: { lat: 52.5469, lng: 4.6608 } },
  { naam: "Heiloo", coords: { lat: 52.5994, lng: 4.7039 } },
  { naam: "Bergen", coords: { lat: 52.6661, lng: 4.6964 } },
  { naam: "Egmond aan Zee", coords: { lat: 52.6206, lng: 4.6300 } },

  // Randstad — Zuid-Holland
  { naam: "Rotterdam", coords: { lat: 51.9244, lng: 4.4777 } },
  { naam: "Den Haag", coords: { lat: 52.0705, lng: 4.3007 } },
  { naam: "Leiden", coords: { lat: 52.1601, lng: 4.4970 } },
  { naam: "Dordrecht", coords: { lat: 51.8133, lng: 4.6900 } },
  { naam: "Zoetermeer", coords: { lat: 52.0570, lng: 4.4931 } },
  { naam: "Delft", coords: { lat: 52.0116, lng: 4.3571 } },
  { naam: "Schiedam", coords: { lat: 51.9192, lng: 4.3886 } },
  { naam: "Vlaardingen", coords: { lat: 51.9120, lng: 4.3416 } },
  { naam: "Spijkenisse", coords: { lat: 51.8459, lng: 4.3294 } },
  { naam: "Capelle aan den IJssel", coords: { lat: 51.9303, lng: 4.5781 } },
  { naam: "Alphen aan den Rijn", coords: { lat: 52.1257, lng: 4.6586 } },
  { naam: "Gouda", coords: { lat: 52.0115, lng: 4.7104 } },
  { naam: "Westland", coords: { lat: 51.9881, lng: 4.2010 } },
  { naam: "Naaldwijk", coords: { lat: 51.9947, lng: 4.2010 } },
  { naam: "Pijnacker", coords: { lat: 52.0182, lng: 4.4243 } },
  { naam: "Rijswijk", coords: { lat: 52.0367, lng: 4.3239 } },
  { naam: "Maassluis", coords: { lat: 51.9220, lng: 4.2480 } },
  { naam: "Krimpen aan den IJssel", coords: { lat: 51.9156, lng: 4.5972 } },
  { naam: "Ridderkerk", coords: { lat: 51.8731, lng: 4.6022 } },
  { naam: "Barendrecht", coords: { lat: 51.8556, lng: 4.5375 } },
  { naam: "Hellevoetsluis", coords: { lat: 51.8267, lng: 4.1394 } },
  { naam: "Voorburg", coords: { lat: 52.0683, lng: 4.3667 } },
  { naam: "Leidschendam", coords: { lat: 52.0814, lng: 4.4036 } },
  { naam: "Wassenaar", coords: { lat: 52.1431, lng: 4.4011 } },
  { naam: "Katwijk", coords: { lat: 52.2031, lng: 4.4022 } },

  // Utrecht
  { naam: "Utrecht", coords: { lat: 52.0907, lng: 5.1214 } },
  { naam: "Amersfoort", coords: { lat: 52.1561, lng: 5.3878 } },
  { naam: "Nieuwegein", coords: { lat: 52.0297, lng: 5.0858 } },
  { naam: "Veenendaal", coords: { lat: 52.0264, lng: 5.5520 } },
  { naam: "Houten", coords: { lat: 52.0319, lng: 5.1681 } },
  { naam: "Zeist", coords: { lat: 52.0894, lng: 5.2317 } },
  { naam: "IJsselstein", coords: { lat: 52.0211, lng: 5.0381 } },
  { naam: "Vleuten", coords: { lat: 52.1022, lng: 5.0028 } },
  { naam: "Woerden", coords: { lat: 52.0865, lng: 4.8835 } },
  { naam: "De Bilt", coords: { lat: 52.1117, lng: 5.1875 } },
  { naam: "Soest", coords: { lat: 52.1736, lng: 5.2906 } },
  { naam: "Maarssen", coords: { lat: 52.1397, lng: 5.0414 } },

  // Noord-Brabant
  { naam: "Eindhoven", coords: { lat: 51.4416, lng: 5.4697 } },
  { naam: "Tilburg", coords: { lat: 51.5555, lng: 5.0913 } },
  { naam: "Breda", coords: { lat: 51.5719, lng: 4.7683 } },
  { naam: "'s-Hertogenbosch", coords: { lat: 51.6997, lng: 5.3047 } },
  { naam: "Helmond", coords: { lat: 51.4793, lng: 5.6611 } },
  { naam: "Oss", coords: { lat: 51.7642, lng: 5.5180 } },
  { naam: "Roosendaal", coords: { lat: 51.5300, lng: 4.4653 } },
  { naam: "Bergen op Zoom", coords: { lat: 51.4944, lng: 4.2872 } },
  { naam: "Veldhoven", coords: { lat: 51.4192, lng: 5.4033 } },
  { naam: "Waalwijk", coords: { lat: 51.6864, lng: 5.0700 } },
  { naam: "Uden", coords: { lat: 51.6622, lng: 5.6172 } },
  { naam: "Etten-Leur", coords: { lat: 51.5697, lng: 4.6356 } },
  { naam: "Geldrop", coords: { lat: 51.4197, lng: 5.5567 } },
  { naam: "Boxtel", coords: { lat: 51.5897, lng: 5.3247 } },
  { naam: "Cuijk", coords: { lat: 51.7286, lng: 5.8806 } },
  { naam: "Dongen", coords: { lat: 51.6261, lng: 4.9417 } },
  { naam: "Goirle", coords: { lat: 51.5258, lng: 5.0658 } },
  { naam: "Drunen", coords: { lat: 51.6886, lng: 5.1394 } },
  { naam: "Best", coords: { lat: 51.5089, lng: 5.3953 } },

  // Gelderland
  { naam: "Nijmegen", coords: { lat: 51.8126, lng: 5.8372 } },
  { naam: "Arnhem", coords: { lat: 51.9851, lng: 5.8987 } },
  { naam: "Apeldoorn", coords: { lat: 52.2112, lng: 5.9699 } },
  { naam: "Ede", coords: { lat: 52.0349, lng: 5.6585 } },
  { naam: "Doetinchem", coords: { lat: 51.9650, lng: 6.2884 } },
  { naam: "Harderwijk", coords: { lat: 52.3411, lng: 5.6208 } },
  { naam: "Tiel", coords: { lat: 51.8889, lng: 5.4297 } },
  { naam: "Zutphen", coords: { lat: 52.1411, lng: 6.1969 } },
  { naam: "Wageningen", coords: { lat: 51.9697, lng: 5.6628 } },
  { naam: "Culemborg", coords: { lat: 51.9550, lng: 5.2256 } },
  { naam: "Winterswijk", coords: { lat: 51.9711, lng: 6.7222 } },
  { naam: "Nunspeet", coords: { lat: 52.3744, lng: 5.7794 } },
  { naam: "Elst", coords: { lat: 51.9211, lng: 5.8458 } },
  { naam: "Velp", coords: { lat: 52.0006, lng: 5.9817 } },

  // Overijssel
  { naam: "Enschede", coords: { lat: 52.2215, lng: 6.8937 } },
  { naam: "Zwolle", coords: { lat: 52.5168, lng: 6.0830 } },
  { naam: "Hengelo", coords: { lat: 52.2659, lng: 6.7935 } },
  { naam: "Almelo", coords: { lat: 52.3565, lng: 6.6628 } },
  { naam: "Deventer", coords: { lat: 52.2661, lng: 6.1552 } },
  { naam: "Kampen", coords: { lat: 52.5550, lng: 5.9111 } },
  { naam: "Hardenberg", coords: { lat: 52.5739, lng: 6.6189 } },
  { naam: "Oldenzaal", coords: { lat: 52.3128, lng: 6.9281 } },

  // Flevoland
  { naam: "Almere", coords: { lat: 52.3508, lng: 5.2647 } },
  { naam: "Lelystad", coords: { lat: 52.5184, lng: 5.4714 } },
  { naam: "Emmeloord", coords: { lat: 52.7100, lng: 5.7472 } },
  { naam: "Dronten", coords: { lat: 52.5253, lng: 5.7203 } },

  // Friesland
  { naam: "Leeuwarden", coords: { lat: 53.2014, lng: 5.7999 } },
  { naam: "Drachten", coords: { lat: 53.1067, lng: 6.0939 } },
  { naam: "Sneek", coords: { lat: 53.0322, lng: 5.6586 } },
  { naam: "Heerenveen", coords: { lat: 52.9594, lng: 5.9192 } },

  // Groningen
  { naam: "Groningen", coords: { lat: 53.2194, lng: 6.5665 } },
  { naam: "Hoogezand", coords: { lat: 53.1622, lng: 6.7558 } },
  { naam: "Veendam", coords: { lat: 53.1056, lng: 6.8775 } },
  { naam: "Stadskanaal", coords: { lat: 52.9911, lng: 6.9644 } },

  // Drenthe
  { naam: "Assen", coords: { lat: 52.9925, lng: 6.5642 } },
  { naam: "Emmen", coords: { lat: 52.7858, lng: 6.8975 } },
  { naam: "Hoogeveen", coords: { lat: 52.7228, lng: 6.4789 } },
  { naam: "Meppel", coords: { lat: 52.6961, lng: 6.1936 } },
  { naam: "Coevorden", coords: { lat: 52.6597, lng: 6.7397 } },

  // Limburg
  { naam: "Maastricht", coords: { lat: 50.8514, lng: 5.6909 } },
  { naam: "Heerlen", coords: { lat: 50.8881, lng: 5.9794 } },
  { naam: "Sittard", coords: { lat: 51.0014, lng: 5.8711 } },
  { naam: "Geleen", coords: { lat: 50.9719, lng: 5.8278 } },
  { naam: "Venlo", coords: { lat: 51.3704, lng: 6.1724 } },
  { naam: "Roermond", coords: { lat: 51.1942, lng: 5.9869 } },
  { naam: "Weert", coords: { lat: 51.2519, lng: 5.7058 } },
  { naam: "Venray", coords: { lat: 51.5253, lng: 5.9750 } },
  { naam: "Kerkrade", coords: { lat: 50.8669, lng: 6.0628 } },
  { naam: "Brunssum", coords: { lat: 50.9472, lng: 5.9722 } },

  // Zeeland
  { naam: "Middelburg", coords: { lat: 51.4988, lng: 3.6109 } },
  { naam: "Vlissingen", coords: { lat: 51.4423, lng: 3.5736 } },
  { naam: "Goes", coords: { lat: 51.5042, lng: 3.8881 } },
  { naam: "Terneuzen", coords: { lat: 51.3361, lng: 3.8275 } },
];

/**
 * Geeft de plaatsen-namen terug waarvan de centroid binnen `radiusKm` van
 * `center` ligt, gesorteerd op afstand. Geschikt om door te geven aan
 * `kvk_zoeken({plaatsen})`.
 *
 * Cap op `maxPlaatsen` (default 12) zodat een grote radius niet leidt tot
 * een KvK-search die zelf weer 50+ plaatsen probeert af te lopen — kosten
 * blijven zo voorspelbaar.
 */
export async function plaatsenWithinRadius(
  center: LatLng,
  radiusKm: number,
  opts: { maxPlaatsen?: number } = {},
): Promise<string[]> {
  const all = await loadAllPlaatsen();
  const withDistance = all
    .map((p) => ({ naam: p.naam, dist: haversineKm(center, p.coords) }))
    .filter((p) => p.dist <= radiusKm)
    .sort((a, b) => a.dist - b.dist);
  const max = opts.maxPlaatsen;
  const limited =
    typeof max === "number" && Number.isFinite(max) && max > 0
      ? withDistance.slice(0, Math.floor(max))
      : withDistance;
  return limited.map((p) => p.naam);
}

/** Synchrone variant op de statische fallback — voor tests of code-paden
 * waar je geen async kunt gebruiken. Niet de primaire pad. */
export function plaatsenWithinRadiusStatic(
  center: LatLng,
  radiusKm: number,
  opts: { maxPlaatsen?: number } = {},
): string[] {
  const withDistance = PLAATSEN_STATIC.map((p) => ({
    naam: p.naam,
    dist: haversineKm(center, p.coords),
  }))
    .filter((p) => p.dist <= radiusKm)
    .sort((a, b) => a.dist - b.dist);
  const max = opts.maxPlaatsen;
  const limited =
    typeof max === "number" && Number.isFinite(max) && max > 0
      ? withDistance.slice(0, Math.floor(max))
      : withDistance;
  return limited.map((p) => p.naam);
}
