// Minimale shape die we uit KvK Handelsregister API consumeren. De
// echte respons bevat veel meer velden; we projecteren naar wat onze
// pijplijn daadwerkelijk gebruikt. Extra velden bewaren we in raw_data
// JSONB zodat latere agents ze alsnog kunnen ontsluiten zonder migratie.

export type KvkFteKlasse =
  | "0"
  | "1"
  | "2-4"
  | "5-9"
  | "10-19"
  | "20-49"
  | "50-99"
  | "100-199"
  | "200-499"
  | ">500";

export type KvkZoekResult = {
  kvkNummer: string;
  handelsnaam: string;
  statutaireNaam?: string;
  sbiCodes: string[];
  vestigingsnummer?: string;
  provincie?: string;
  plaats?: string;
  straatnaam?: string;
  huisnummer?: string;
  postcode?: string;
  indicatieHoofdvestiging?: boolean;
};

export type KvkBestuurder = {
  naam: string;
  functie?: string;
  sinds?: string; // ISO-datum
};

export type KvkVestiging = {
  vestigingsnummer: string;
  isHoofdvestiging: boolean;
  handelsnaam: string;
  adres: string;
  plaats?: string;
  provincie?: string;
};

export type KvkBasisprofiel = {
  kvkNummer: string;
  naam: string;
  handelsnaam?: string;
  websiteUrl?: string;
  sbiCodes: string[];
  fteKlasse?: KvkFteKlasse;
  // Rechtsvorm: "besloten vennootschap", "naamloze vennootschap" etc.
  bestuursvorm?: string;
  oprichtingsdatum?: string; // ISO
  actief: boolean;
  bestuurders: KvkBestuurder[];
  vestigingen: KvkVestiging[];
  provincie?: string;
  plaats?: string;
  raw: unknown; // origineel antwoord, voor kvk_snapshots.raw_data
};

// FTE-klasse mapping naar onze UI-labels. KvK's werknemers-veld is een
// losse integer; we bucketten 'm in de klassen die de UI-filter gebruikt.
export function bucketFte(werknemers: number | undefined): string | undefined {
  if (werknemers === undefined || werknemers === null) return undefined;
  if (werknemers < 10) return "<10";
  if (werknemers <= 19) return "10-19";
  if (werknemers <= 49) return "20-49";
  if (werknemers <= 99) return "50-99";
  if (werknemers <= 199) return "100-199";
  return ">200";
}
