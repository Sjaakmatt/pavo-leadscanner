// High-level CBS-queries voor PAVO lead-context. Eén functie per dataset
// die de ruwe OData-rijen omzet naar een gebruikersvriendelijke
// snapshot.
//
// Tijdlijn-strategie: alle queries pakken de meest recente periode
// (sortering desc, top 1). De ruwe OData heeft "Perioden"-velden zoals
// "2024KW04" (kwartaal) of "2024JJ00" (jaar). We tonen ze gewoon zoals
// CBS ze geeft — de UI render't 'm.

import { fetchCbs } from "./client.js";
import { sbiToBedrijfstak, ALLE, type CbsBedrijfstak } from "./sbi-mapping.js";
import {
  provincieNaarRegio,
  NEDERLAND_REGIO,
  type CbsRegio,
} from "./regio-mapping.js";

// ---- Dataset 80072NED — Ziekteverzuim per bedrijfstak ----------------

interface ZiekteverzuimRow {
  Perioden: string;
  Ziekteverzuimpercentage_1: number | null;
}

export interface BrancheVerzuim {
  branche: string;
  periode: string;
  percentage: number | null;
  landelijkPercentage: number | null;
}

export async function fetchVerzuim(sbiCode: string | null): Promise<BrancheVerzuim | null> {
  const branche = sbiToBedrijfstak(sbiCode);
  const [eigen, landelijk] = await Promise.all([
    fetchCbs<ZiekteverzuimRow>({
      tableId: "80072NED",
      filter: `BedrijfstakkenSBI2008 eq '${branche.code}'`,
      select: "Perioden,Ziekteverzuimpercentage_1",
      orderby: "Perioden desc",
      top: 1,
    }),
    branche.code === ALLE.code
      ? Promise.resolve([] as ZiekteverzuimRow[])
      : fetchCbs<ZiekteverzuimRow>({
          tableId: "80072NED",
          filter: `BedrijfstakkenSBI2008 eq '${ALLE.code}'`,
          select: "Perioden,Ziekteverzuimpercentage_1",
          orderby: "Perioden desc",
          top: 1,
        }),
  ]);

  const eigenRow = eigen[0];
  if (!eigenRow) return null;
  return {
    branche: branche.naam,
    periode: eigenRow.Perioden,
    percentage: eigenRow.Ziekteverzuimpercentage_1,
    landelijkPercentage: landelijk[0]?.Ziekteverzuimpercentage_1 ?? null,
  };
}

// ---- Dataset 80590NED — Spanningsindicator (krapte arbeidsmarkt) -----
//
// CBS geeft per arbeidsmarkt-regio een spanningsindicator op
// kwartaal-basis. Categorieën: 'Ruim' / 'Gemiddeld' / 'Krap' / 'Zeer krap'.
// Numeriek = (openstaande vacatures × 100) / kortdurende WW-uitkeringen.

interface KrapteRow {
  Perioden: string;
  // Veldnaam wisselt per dataset-versie; we proberen meerdere kandidaten.
  Spanningsindicator_1?: number | null;
  SpanningOpDeArbeidsmarkt_1?: number | null;
}

export interface BrancheKrapte {
  regio: string;
  periode: string;
  indicator: number | null;
  classificatie: "ruim" | "gemiddeld" | "krap" | "zeer_krap" | "onbekend";
}

export async function fetchKrapte(provincie: string | null): Promise<BrancheKrapte | null> {
  const regio = provincieNaarRegio(provincie);
  const rows = await fetchCbs<KrapteRow>({
    tableId: "80590NED",
    filter: `RegioS eq '${regio.arbeidsmarktregioCode}'`,
    select: "Perioden,Spanningsindicator_1,SpanningOpDeArbeidsmarkt_1",
    orderby: "Perioden desc",
    top: 1,
  });
  const row = rows[0];
  if (!row) return null;
  const indicator = row.Spanningsindicator_1 ?? row.SpanningOpDeArbeidsmarkt_1 ?? null;
  return {
    regio: regio.arbeidsmarktregio,
    periode: row.Perioden,
    indicator,
    classificatie: classifyKrapte(indicator),
  };
}

function classifyKrapte(
  indicator: number | null,
): "ruim" | "gemiddeld" | "krap" | "zeer_krap" | "onbekend" {
  if (indicator === null) return "onbekend";
  // CBS-grenzen (vacatures per 100 werklozen, omgekeerde-schaal):
  // <50 = ruim, 50-83 = gemiddeld, 83-125 = krap, >125 = zeer krap.
  if (indicator < 50) return "ruim";
  if (indicator < 83) return "gemiddeld";
  if (indicator < 125) return "krap";
  return "zeer_krap";
}

// ---- Dataset 82800NED — Vacaturegraad per bedrijfstak -----------------
//
// "Aantal openstaande vacatures per 1000 banen". Geeft sectoraal beeld
// van wervings-druk.

interface VacaturegraadRow {
  Perioden: string;
  OpenstaandeVacatures_1?: number | null;
  Vacaturegraad_1?: number | null;
}

export interface BrancheVacaturegraad {
  branche: string;
  periode: string;
  vacaturegraad: number | null;
  landelijk: number | null;
}

export async function fetchVacaturegraad(sbiCode: string | null): Promise<BrancheVacaturegraad | null> {
  const branche = sbiToBedrijfstak(sbiCode);
  const [eigen, landelijk] = await Promise.all([
    fetchCbs<VacaturegraadRow>({
      tableId: "82800NED",
      filter: `BedrijfstakkenSBI2008 eq '${branche.code}'`,
      select: "Perioden,Vacaturegraad_1,OpenstaandeVacatures_1",
      orderby: "Perioden desc",
      top: 1,
    }),
    branche.code === ALLE.code
      ? Promise.resolve([] as VacaturegraadRow[])
      : fetchCbs<VacaturegraadRow>({
          tableId: "82800NED",
          filter: `BedrijfstakkenSBI2008 eq '${ALLE.code}'`,
          select: "Perioden,Vacaturegraad_1",
          orderby: "Perioden desc",
          top: 1,
        }),
  ]);
  const row = eigen[0];
  if (!row) return null;
  return {
    branche: branche.naam,
    periode: row.Perioden,
    vacaturegraad: row.Vacaturegraad_1 ?? row.OpenstaandeVacatures_1 ?? null,
    landelijk: landelijk[0]?.Vacaturegraad_1 ?? landelijk[0]?.OpenstaandeVacatures_1 ?? null,
  };
}

// ---- Dataset 84244NED — Faillissementen per bedrijfstak --------------
//
// Maandcijfers per branche. We pakken laatste 12 maanden + bereken YoY.

interface FaillissementRow {
  Perioden: string;
  Faillissementen_1?: number | null;
}

export interface BrancheFaillissementen {
  branche: string;
  laatsteMaand: { periode: string; aantal: number | null } | null;
  twaalfMaandsTotaal: number | null;
  yoyVerschil: number | null; // procentpunten t.o.v. zelfde periode jaar geleden
}

export async function fetchFaillissementen(sbiCode: string | null): Promise<BrancheFaillissementen | null> {
  const branche = sbiToBedrijfstak(sbiCode);
  const rows = await fetchCbs<FaillissementRow>({
    tableId: "84244NED",
    filter: `BedrijfstakkenSBI2008 eq '${branche.code}'`,
    select: "Perioden,Faillissementen_1",
    orderby: "Perioden desc",
    top: 24,
  });
  if (rows.length === 0) return null;

  const laatste12 = rows.slice(0, 12);
  const vorige12 = rows.slice(12, 24);
  const sum = (xs: FaillissementRow[]) =>
    xs.reduce((s, r) => s + (r.Faillissementen_1 ?? 0), 0);
  const huidigTotaal = sum(laatste12);
  const vorigTotaal = sum(vorige12);
  const yoy = vorigTotaal > 0 ? ((huidigTotaal - vorigTotaal) / vorigTotaal) * 100 : null;

  const eerste = rows[0];
  return {
    branche: branche.naam,
    laatsteMaand: eerste
      ? { periode: eerste.Perioden, aantal: eerste.Faillissementen_1 ?? null }
      : null,
    twaalfMaandsTotaal: huidigTotaal,
    yoyVerschil: yoy,
  };
}

// ---- Dataset 84498NED — CAO-loonontwikkeling per bedrijfstak ---------

interface CaoLoonRow {
  Perioden: string;
  IndexCijferCaoLoonPerUur_1?: number | null;
  IndexCijferCaoLonenPerUur_1?: number | null;
}

export interface BrancheCaoLoon {
  branche: string;
  periode: string;
  yoyPercentage: number | null;
}

export async function fetchCaoLoon(sbiCode: string | null): Promise<BrancheCaoLoon | null> {
  const branche = sbiToBedrijfstak(sbiCode);
  const rows = await fetchCbs<CaoLoonRow>({
    tableId: "84498NED",
    filter: `BedrijfstakkenSBI2008 eq '${branche.code}'`,
    select: "Perioden,IndexCijferCaoLoonPerUur_1,IndexCijferCaoLonenPerUur_1",
    orderby: "Perioden desc",
    top: 13, // 12 maanden + 1 voor YoY-base
  });
  if (rows.length < 13) return null;

  const huidig =
    rows[0]?.IndexCijferCaoLoonPerUur_1 ??
    rows[0]?.IndexCijferCaoLonenPerUur_1 ??
    null;
  const jaarTerug =
    rows[12]?.IndexCijferCaoLoonPerUur_1 ??
    rows[12]?.IndexCijferCaoLonenPerUur_1 ??
    null;

  const yoy =
    huidig !== null && jaarTerug !== null && jaarTerug > 0
      ? ((huidig - jaarTerug) / jaarTerug) * 100
      : null;

  return {
    branche: branche.naam,
    periode: rows[0].Perioden,
    yoyPercentage: yoy,
  };
}

// ---- Combined snapshot voor de lead-detail card ----------------------

export interface BrancheContext {
  branche: { code: string; naam: string };
  regio: { code: string; naam: string };
  verzuim: BrancheVerzuim | null;
  krapte: BrancheKrapte | null;
  vacaturegraad: BrancheVacaturegraad | null;
  faillissementen: BrancheFaillissementen | null;
  caoLoon: BrancheCaoLoon | null;
}

/**
 * Combineer alle 5 datasets in één snapshot voor een lead.
 * Caching gebeurt per dataset onder de hood.
 */
export async function fetchBrancheContext(args: {
  sbiCode: string | null;
  provincie: string | null;
}): Promise<BrancheContext> {
  const branche = sbiToBedrijfstak(args.sbiCode);
  const regio = provincieNaarRegio(args.provincie);
  const [verzuim, krapte, vacaturegraad, faillissementen, caoLoon] =
    await Promise.all([
      fetchVerzuim(args.sbiCode),
      fetchKrapte(args.provincie),
      fetchVacaturegraad(args.sbiCode),
      fetchFaillissementen(args.sbiCode),
      fetchCaoLoon(args.sbiCode),
    ]);
  return {
    branche: { code: branche.code, naam: branche.naam },
    regio: { code: regio.arbeidsmarktregioCode, naam: regio.arbeidsmarktregio },
    verzuim,
    krapte,
    vacaturegraad,
    faillissementen,
    caoLoon,
  };
}

export type { CbsBedrijfstak, CbsRegio };
