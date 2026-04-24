// KvK Handelsregister API client. Valt automatisch terug op mock als er
// geen echte `KVK_API_KEY` is — zo kan de pijplijn end-to-end getest
// worden zonder Dataservice-abonnement.
//
// Endpoints (https://developers.kvk.nl):
//   GET /api/v2/zoeken        — bedrijven zoeken op SBI + omvang + regio
//   GET /api/v1/basisprofielen/{kvk}  — volledig profiel per bedrijf
//
// Rate-limit: 100 rpm per abonnement. We cappen op 80 rpm (zie
// rate-limiter.ts) zodat pieken niet 429'en. Exponential backoff bij
// 429's en 5xx's.

import {
  kvkGetBasisprofielMock,
  kvkZoekBedrijvenMock,
} from "./mock";
import { acquireToken } from "./rate-limiter";
import type {
  KvkBasisprofiel,
  KvkBestuurder,
  KvkVestiging,
  KvkZoekResult,
} from "./types";
import { bucketFte } from "./types";

const KVK_BASE_URL = "https://api.kvk.nl";

type KvkMode = "real" | "mock";

function readApiKey(): { mode: KvkMode; key?: string } {
  const key = process.env.KVK_API_KEY;
  if (!key || key.trim() === "" || /placeholder/i.test(key)) {
    return { mode: "mock" };
  }
  return { mode: "real", key };
}

function headers(apiKey: string): HeadersInit {
  return {
    apikey: apiKey,
    Accept: "application/hal+json",
  };
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { maxAttempts?: number; label?: string } = {},
): Promise<Response> {
  const { maxAttempts = 4, label = "kvk" } = opts;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await acquireToken("kvk");
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        const wait = 500 * 2 ** (attempt - 1);
        console.warn(
          `[${label}] ${res.status} op ${url}, retry ${attempt}/${maxAttempts - 1} over ${wait}ms`,
        );
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`[${label}] faalde na ${maxAttempts} pogingen: ${String(lastErr)}`);
}

// ---------- zoeken --------------------------------------------------------

type KvkZoekenRawItem = {
  kvkNummer: string;
  vestigingsnummer?: string;
  naam?: string;
  handelsnaam?: string;
  statutaireNaam?: string;
  sbiActiviteiten?: Array<{ sbiCode: string; omschrijving?: string }>;
  adres?: {
    binnenlandsAdres?: {
      straatnaam?: string;
      huisnummer?: number | string;
      huisletter?: string;
      postcode?: string;
      plaats?: string;
    };
  };
  provincie?: string;
};

type KvkZoekenResponse = {
  resultaten?: KvkZoekenRawItem[];
  totaal?: number;
};

function projectZoekItem(r: KvkZoekenRawItem): KvkZoekResult {
  const adres = r.adres?.binnenlandsAdres;
  const handelsnaam = r.handelsnaam ?? r.naam ?? r.statutaireNaam ?? "";
  return {
    kvkNummer: r.kvkNummer,
    handelsnaam,
    statutaireNaam: r.statutaireNaam,
    sbiCodes: (r.sbiActiviteiten ?? []).map((a) => a.sbiCode),
    vestigingsnummer: r.vestigingsnummer,
    provincie: r.provincie,
    plaats: adres?.plaats,
    straatnaam: adres?.straatnaam,
    huisnummer: adres?.huisnummer !== undefined ? String(adres.huisnummer) : undefined,
    postcode: adres?.postcode,
    indicatieHoofdvestiging: r.vestigingsnummer ? true : undefined,
  };
}

export async function kvkZoekBedrijven(params: {
  sbiCodes: string[];
  provincies?: string[];
  fteKlassen?: string[]; // post-filter
  limit?: number;
}): Promise<KvkZoekResult[]> {
  const { mode, key } = readApiKey();
  if (mode === "mock") return kvkZoekBedrijvenMock(params);

  const limit = Math.min(params.limit ?? 100, 1000);
  const out: KvkZoekResult[] = [];
  // KvK's zoeken accepteert één SBI-code per request. We doen per SBI
  // een request en mergen de resultaten; dedupen op kvkNummer.
  for (const sbi of params.sbiCodes) {
    const url = new URL(`${KVK_BASE_URL}/api/v2/zoeken`);
    url.searchParams.set("type", "hoofdvestiging");
    url.searchParams.set("sbi", sbi);
    // We kunnen niet direct op provincie filteren in zoeken; dat doen
    // we post-hoc op de `provincie`-velden die KvK teruggeeft.
    url.searchParams.set("resultatenPerPagina", String(Math.min(limit, 100)));
    const res = await fetchWithRetry(
      url.toString(),
      { headers: headers(key!) },
      { label: `kvk:zoeken sbi=${sbi}` },
    );
    if (!res.ok) {
      console.warn(`KvK zoeken faalde voor SBI ${sbi}: HTTP ${res.status}`);
      continue;
    }
    const data = (await res.json()) as KvkZoekenResponse;
    for (const r of data.resultaten ?? []) out.push(projectZoekItem(r));
    if (out.length >= limit) break;
  }

  // Dedupe op kvkNummer (komt voor als bedrijf meerdere SBI's heeft).
  const seen = new Set<string>();
  const deduped = out.filter((r) => {
    if (seen.has(r.kvkNummer)) return false;
    seen.add(r.kvkNummer);
    return true;
  });

  // Optional provincie-post-filter.
  const provFilter = params.provincies?.length ? new Set(params.provincies) : null;
  const filteredByProv = provFilter
    ? deduped.filter((r) => !r.provincie || provFilter.has(r.provincie))
    : deduped;

  return filteredByProv.slice(0, limit);
}

// ---------- basisprofiel --------------------------------------------------

type KvkBasisprofielRaw = {
  kvkNummer: string;
  naam?: string;
  handelsnaam?: string;
  statutaireNaam?: string;
  websiteAdres?: string;
  websiteUrl?: string;
  sbiActiviteiten?: Array<{ sbiCode: string }>;
  werkzamePersonen?: number;
  totaleWerkzamePersonen?: number;
  formeleRegistratiedatum?: string;
  rechtsvorm?: string;
  statutaireZetel?: { plaats?: string; provincie?: string };
  materieleRegistratie?: { datumAanvang?: string; datumEinde?: string };
  bestuurders?: Array<{
    naam: string;
    functie?: string;
    datumAanvang?: string;
  }>;
  vestigingen?: Array<{
    vestigingsnummer: string;
    indicatieHoofdvestiging?: boolean;
    handelsnaam?: string;
    adres?: { binnenlandsAdres?: { volledigAdres?: string; plaats?: string; provincie?: string } };
  }>;
};

function projectBasisprofiel(r: KvkBasisprofielRaw): KvkBasisprofiel {
  const naam = r.naam ?? r.handelsnaam ?? r.statutaireNaam ?? r.kvkNummer;
  const werknemers = r.totaleWerkzamePersonen ?? r.werkzamePersonen;
  const bestuurders: KvkBestuurder[] = (r.bestuurders ?? []).map((b) => ({
    naam: b.naam,
    functie: b.functie,
    sinds: b.datumAanvang,
  }));
  const vestigingen: KvkVestiging[] = (r.vestigingen ?? []).map((v) => ({
    vestigingsnummer: v.vestigingsnummer,
    isHoofdvestiging: !!v.indicatieHoofdvestiging,
    handelsnaam: v.handelsnaam ?? naam,
    adres: v.adres?.binnenlandsAdres?.volledigAdres ?? "",
    plaats: v.adres?.binnenlandsAdres?.plaats,
    provincie: v.adres?.binnenlandsAdres?.provincie,
  }));
  const mainVestiging =
    vestigingen.find((v) => v.isHoofdvestiging) ?? vestigingen[0];
  const fteKlasse = bucketFte(werknemers) as KvkBasisprofiel["fteKlasse"];
  return {
    kvkNummer: r.kvkNummer,
    naam,
    handelsnaam: r.handelsnaam,
    websiteUrl: r.websiteAdres ?? r.websiteUrl,
    sbiCodes: (r.sbiActiviteiten ?? []).map((a) => a.sbiCode),
    fteKlasse,
    bestuursvorm: r.rechtsvorm,
    oprichtingsdatum: r.formeleRegistratiedatum,
    actief: !r.materieleRegistratie?.datumEinde,
    bestuurders,
    vestigingen,
    provincie: mainVestiging?.provincie ?? r.statutaireZetel?.provincie,
    plaats: mainVestiging?.plaats ?? r.statutaireZetel?.plaats,
    raw: r,
  };
}

// Simple in-memory cache — 24 uur TTL. Basisprofielen muteren traag;
// dit scheelt enorm op herhaalde searches binnen dezelfde dag.
const profileCache = new Map<string, { at: number; profile: KvkBasisprofiel }>();
const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

export async function kvkGetBasisprofiel(
  kvk: string,
  opts: { bypassCache?: boolean } = {},
): Promise<KvkBasisprofiel> {
  const now = Date.now();
  if (!opts.bypassCache) {
    const cached = profileCache.get(kvk);
    if (cached && now - cached.at < PROFILE_TTL_MS) return cached.profile;
  }
  const { mode, key } = readApiKey();
  if (mode === "mock") {
    const profile = kvkGetBasisprofielMock(kvk);
    profileCache.set(kvk, { at: now, profile });
    return profile;
  }
  const url = `${KVK_BASE_URL}/api/v1/basisprofielen/${encodeURIComponent(kvk)}`;
  const res = await fetchWithRetry(
    url,
    { headers: headers(key!) },
    { label: `kvk:basisprofiel ${kvk}` },
  );
  if (!res.ok) {
    throw new Error(`KvK basisprofiel faalde voor ${kvk}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as KvkBasisprofielRaw;
  const profile = projectBasisprofiel(data);
  profileCache.set(kvk, { at: now, profile });
  return profile;
}

// ---------- snapshot -------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";

export async function kvkSnapshotAndStore(
  kvk: string,
  supabase: SupabaseClient,
): Promise<KvkBasisprofiel> {
  const profile = await kvkGetBasisprofiel(kvk);
  const { error } = await supabase.from("kvk_snapshots").insert({
    kvk,
    raw_data: profile.raw as object,
    fte_klasse: profile.fteKlasse,
    bestuurders: profile.bestuurders,
    vestigingen: profile.vestigingen,
  });
  if (error) throw new Error(`kvk_snapshots insert faalde: ${error.message}`);
  return profile;
}

export function kvkIsMockMode(): boolean {
  return readApiKey().mode === "mock";
}
