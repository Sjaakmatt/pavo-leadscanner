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

  const variants = [parsed];
  if (parsed.hostname.startsWith("www.")) {
    const withoutWww = new URL(parsed.toString());
    withoutWww.hostname = parsed.hostname.slice(4);
    variants.push(withoutWww);
  } else {
    const withWww = new URL(parsed.toString());
    withWww.hostname = `www.${parsed.hostname}`;
    variants.push(withWww);
  }

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
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 200-399 = host werkt. 405 (Method Not Allowed) en 403 (Forbidden)
    // accepteren we ook — host bestaat, server weigert HEAD-method maar
    // GET zou werken (de scraper doet GET).
    return res.ok || res.status === 405 || res.status === 403;
  } catch {
    return false;
  }
}
