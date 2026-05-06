// Website-inference voor bedrijven die geen websiteUrl hebben in hun
// KvK-basisprofiel. KvK is afhankelijk van zelf-geregistreerde data —
// veel BV's geven hun website nooit door, waardoor de scrape-pipeline
// website + vacatures helemaal overslaat (zie scrape-and-classify.ts:
// `if (company.websiteUrl)`). Resultaat: lead krijgt 0 signalen ondanks
// dat de bedrijfssite wel degelijk vacatures of HR-info bevat.
//
// Voorbeeld dat dit reproduceert: Joz B.V. (KvK 36041158, joz.nl) had
// niets in KvK.websiteUrls maar de site bevat actieve vacatures.
//
// Strategie: genereer een lijst kandidaat-URLs uit de bedrijfsnaam
// (slug + .nl/.com varianten), doe HEAD-checks parallel met korte
// timeout, neem de eerste werkende. Best-effort — geen match → null.

// Suffix-stripping voor NL bedrijfsvormen. We willen "Joz B.V." tot
// "joz" reduceren, niet "joz-bv".
const NL_COMPANY_SUFFIX_RE =
  /\s+(?:b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?|c\.?v\.?|holding|beheer|groep|group|nederland|the\s+netherlands)\s*$/gi;

const PROBE_TIMEOUT_MS = 3_000;
const MAX_PROBES_PER_NAAM = 6;

/**
 * Probeer een werkende website-URL af te leiden uit de bedrijfsnaam.
 * Doet HEAD-fetches op kandidaat-URLs (max ~6 stuks) en retourneert
 * de eerste die 200-399 (of 403/405 — host bestaat maar weigert HEAD).
 */
export async function inferWebsiteUrl(
  naam: string,
): Promise<string | null> {
  const candidates = generateCandidates(naam);
  for (const url of candidates) {
    if (await probeUrl(url, PROBE_TIMEOUT_MS)) return url;
  }
  return null;
}

/**
 * Valideer een bekende website-URL en probeer de www/non-www variant als
 * de geregistreerde URL niet bereikbaar is.
 */
export async function resolveWebsiteUrl(
  websiteUrl: string,
): Promise<string | null> {
  const candidates = generateUrlVariants(websiteUrl);
  for (const url of candidates) {
    if (await probeUrl(url, PROBE_TIMEOUT_MS)) return url;
  }
  return null;
}

export function generateCandidates(naam: string): string[] {
  if (!naam) return [];
  // Strip company-vormen + lowercase + verwijder leestekens
  const cleaned = naam
    .replace(NL_COMPANY_SUFFIX_RE, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];

  // Twee slug-varianten: met streepjes en zonder spaties.
  // "jan jansen bouw" → ["jan-jansen-bouw", "janjansenbouw"]
  const slugDashed = cleaned.replace(/\s+/g, "-").replace(/-+/g, "-");
  const slugCompact = cleaned.replace(/\s+/g, "");
  const slugs = new Set<string>();
  if (slugDashed.length >= 2) slugs.add(slugDashed);
  if (slugCompact.length >= 2) slugs.add(slugCompact);

  // Voor lange namen ook het eerste woord proberen — "Bouwbedrijf Jansen"
  // wordt vaak als "jansen.nl" gepresenteerd. Alleen als eerste woord
  // tenminste 4 chars heeft (anders te generiek).
  const firstWord = cleaned.split(" ")[0];
  if (firstWord && firstWord.length >= 4) slugs.add(firstWord);

  // .nl eerst (NL-bias), dan .com. Geen .net/.org — te zeldzaam voor MKB
  // en vergroot de probe-budget zonder veel extra hits.
  const tlds = [".nl", ".com"];
  const out: string[] = [];
  for (const slug of slugs) {
    for (const tld of tlds) {
      out.push(`https://${slug}${tld}`);
      out.push(`https://www.${slug}${tld}`);
      if (out.length >= MAX_PROBES_PER_NAAM) return out;
    }
  }
  return out;
}

export function generateUrlVariants(websiteUrl: string): string[] {
  const parsed = parseWebsiteUrl(websiteUrl);
  if (!parsed) return [];

  // Strategie: probeer ALTIJD non-www eerst. Bare-domain is vrijwel
  // altijd de canonical host (KvK-input vaak met www, maar werkende
  // server zit op bare). Pas www proberen als niet-www faalt.
  // Voorbeeld dat dit triggerde: hardernatuursteen.nl werkt, maar
  // www.hardernatuursteen.nl serveert lege/parking-content.
  const bare = new URL(parsed.toString());
  if (bare.hostname.startsWith("www.")) {
    bare.hostname = bare.hostname.slice(4);
  }
  const wwwUrl = new URL(parsed.toString());
  if (!wwwUrl.hostname.startsWith("www.")) {
    wwwUrl.hostname = `www.${wwwUrl.hostname}`;
  }

  const variants = [bare, wwwUrl];
  return [...new Set(variants.map((url) => url.toString()))];
}

function parseWebsiteUrl(websiteUrl: string): URL | null {
  try {
    return new URL(websiteUrl);
  } catch {
    try {
      return new URL(`https://${websiteUrl}`);
    } catch {
      return null;
    }
  }
}

async function probeUrl(url: string, timeoutMs: number): Promise<boolean> {
  // Stap 1: HEAD — snel, scheelt bandbreedte. Sommige servers blokkeren
  // HEAD volledig (Cloudflare, sommige WordPress-installaties) of
  // geven willekeurige timeouts.
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok || res.status === 405 || res.status === 403) return true;
    // Gegeven status. Als 4xx/5xx-non-405/403, geef nog een GET-shot;
    // sommige servers retourneren 400 op HEAD maar 200 op GET.
    if (res.status >= 400) {
      return await probeWithGet(url, timeoutMs);
    }
    return false;
  } catch {
    // HEAD-timeout of netwerk-fout → probeer GET als fallback
    return await probeWithGet(url, timeoutMs);
  }
}

async function probeWithGet(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        // Range-header: pak alleen eerste KB om bandbreedte te sparen.
        // Servers die Range niet ondersteunen retourneren gewoon 200
        // (volledig content) — ook OK voor onze probe.
        Range: "bytes=0-1023",
        // Echte browser-UA: sommige sites blokkeren onbekende UAs met
        // 403, terwijl een browser-UA wel werkt.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: "text/html,*/*",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok || res.status === 206 || res.status === 403) return true;
    return false;
  } catch {
    return false;
  }
}
