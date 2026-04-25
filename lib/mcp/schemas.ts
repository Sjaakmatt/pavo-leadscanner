// Zod-schemas voor de payloads die de twee MCPs retourneren.
//
// Match 1:1 met @factumai/mcp-bedrijven en @factumai/mcp-webscraper. Bij
// mismatch is dat een contract-schending — open een issue in factumai-mcps,
// pas hier niet eenzijdig aan.
//
// `passthrough()` op de root-schemas zodat extra velden uit de MCP
// (bv. raw-data) niet hard breken; we projecteren naar wat we gebruiken.

import { z } from "zod";

// ============ mcp-bedrijven ============

export const KvkZoekHit = z
  .object({
    kvkNummer: z.string(),
    naam: z.string(),
    handelsnaam: z.string().optional(),
    vestigingsnummer: z.string().optional(),
    sbiCodes: z.array(z.string()),
    adres: z.object({
      straat: z.string().optional(),
      huisnummer: z.string().optional(),
      postcode: z.string().optional(),
      plaats: z.string(),
      provincie: z.string().optional(),
    }),
    // Optioneel: MCP MAG fteKlasse meegeven uit de KvK-werknemers-bucket.
    // Niet vereist (sommige KvK-records bevatten 'm niet); wanneer wel
    // aanwezig gebruiken we 'm voor de FTE-filter.
    fteKlasse: z.string().optional(),
  })
  .passthrough();
export type KvkZoekHit = z.infer<typeof KvkZoekHit>;

export const KvkBestuurder = z.object({
  naam: z.string(),
  functie: z.string(),
  sinds: z.string().optional(),
});

export const KvkVestiging = z.object({
  vestigingsnummer: z.string(),
  adres: z.object({
    plaats: z.string(),
    provincie: z.string().optional(),
  }),
  isHoofdvestiging: z.boolean(),
});

export const KvkBasisprofiel = z
  .object({
    kvkNummer: z.string(),
    naam: z.string(),
    handelsnamen: z.array(z.string()),
    websiteUrls: z.array(z.string().url()),
    sbiCodes: z.array(z.string()),
    bestuursvorm: z.string(),
    oprichtingsdatum: z.string().optional(),
    bestuurders: z.array(KvkBestuurder),
    vestigingen: z.array(KvkVestiging),
    actief: z.boolean(),
    fteKlasse: z.string().optional(),
  })
  .passthrough();
export type KvkBasisprofiel = z.infer<typeof KvkBasisprofiel>;

export const Geocode = z
  .object({
    plaats: z.string(),
    lat: z.number(),
    lng: z.number(),
    matchType: z.enum(["plaats", "adres", "postcode"]),
  })
  .passthrough();
export type Geocode = z.infer<typeof Geocode>;

export const KvkSnapshot = z
  .object({
    snapshotId: z.string(),
    takenAt: z.string(),
  })
  .passthrough();
export type KvkSnapshot = z.infer<typeof KvkSnapshot>;

// ============ mcp-webscraper (RUWE data, geen signalen) ============

export const ScrapedPage = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  text: z.string(),
  textLength: z.number().int(),
  jobPostings: z
    .array(
      z.object({
        url: z.string().url().optional(),
        title: z.string().optional(),
        datePosted: z.string().optional(),
        description: z.string().optional(),
        jsonLd: z.unknown().optional(),
      }),
    )
    .optional(),
});

export const SitemapEntry = z.object({
  url: z.string().url(),
  lastmod: z.string().optional(),
});

export const WebsiteScrapeResult = z
  .object({
    pages: z.array(ScrapedPage),
    sitemap: z
      .object({
        vacancyUrls: z.array(SitemapEntry),
        totalUrls: z.number().int(),
      })
      .optional(),
    debug: z.object({
      methodUsed: z.enum(["playwright", "web_fetch"]),
      pagesProbed: z.number().int(),
      totalTextLength: z.number().int(),
    }),
  })
  .passthrough();
export type WebsiteScrapeResult = z.infer<typeof WebsiteScrapeResult>;

export const RechtspraakUitspraak = z.object({
  ecli: z.string(),
  titel: z.string().optional(),
  datum: z.string(),
  rechtsgebied: z.string().optional(),
  text: z.string(),
  url: z.string().url(),
});

export const RechtspraakRawResult = z
  .object({
    uitspraken: z.array(RechtspraakUitspraak),
    zakenAantal: z.number().int(),
    namesTried: z.array(z.string()),
    pseudonimiseringSkipped: z.array(z.string()).optional(),
  })
  .passthrough();
export type RechtspraakRawResult = z.infer<typeof RechtspraakRawResult>;

export const NlaOvertreding = z.object({
  bedrijfsnaam: z.string(),
  datum: z.string(),
  type: z.string(),
  wetsartikel: z.string().optional(),
  bron: z.string(),
  url: z.string().url(),
});

export const NlaRawResult = z
  .object({
    overtredingen: z.array(NlaOvertreding),
    portalsChecked: z.array(z.string()),
  })
  .passthrough();
export type NlaRawResult = z.infer<typeof NlaRawResult>;

export const InsolventieZaak = z.object({
  kvkNummer: z.string().optional(),
  bedrijfsnaam: z.string(),
  type: z.enum(["faillissement", "surseance", "wsnp", "andere"]),
  startdatum: z.string(),
  url: z.string().url().optional(),
});

export const InsolventieRawResult = z
  .object({
    zaken: z.array(InsolventieZaak),
    namesTried: z.array(z.string()),
  })
  .passthrough();
export type InsolventieRawResult = z.infer<typeof InsolventieRawResult>;

export const Vacature = z.object({
  url: z.string().url(),
  title: z.string(),
  datePosted: z.string().optional(),
  description: z.string().optional(),
  jsonLd: z.unknown().optional(),
});

export const VacatureRawResult = z
  .object({
    vacatures: z.array(Vacature),
    sitemapUrls: z.array(SitemapEntry),
    oudsteVacature: z.string().optional(),
  })
  .passthrough();
export type VacatureRawResult = z.infer<typeof VacatureRawResult>;

export const NewsItem = z.object({
  title: z.string(),
  snippet: z.string().optional(),
  url: z.string().url(),
  publishedAt: z.string(),
  source: z.string().optional(),
});

export const NewsRawResult = z
  .object({
    items: z.array(NewsItem),
    totalResults: z.number().int(),
  })
  .passthrough();
export type NewsRawResult = z.infer<typeof NewsRawResult>;
