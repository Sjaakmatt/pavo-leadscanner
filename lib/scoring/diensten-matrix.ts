// Signaal → PAVO-dienst mapping. De huidige UI gebruikt 8 diensten (D1-D8,
// zie data/leads.json meta.diensten + lib/adapters/types.ts::DienstCode).
// De briefing noemt 13 diensten maar specificeert D9-D13 niet; laat die
// ruimte open tot Roy de aanvullende diensten aanlevert. Nieuwe diensten
// kunnen simpelweg aan deze matrix worden toegevoegd en aan de
// DienstCode union in lib/adapters/types.ts.

import type { DienstCode } from "@/lib/adapters/types";

export type DienstRegel = {
  code: DienstCode;
  naam: string;
  // Weging per signaal-categorie. Hoger = sterkere match.
  gewicht: Partial<Record<string, number>>;
};

// Namen komen 1-op-1 uit data/leads.json meta.diensten.
export const DIENSTEN_MATRIX: DienstRegel[] = [
  {
    code: "D1",
    naam: "Moeite met vinden van personeel",
    gewicht: {
      veel_open_vacatures: 35,
      langlopende_vacatures: 30,
      herposte_vacatures: 25,
      recruiter_overload: 20,
    },
  },
  {
    code: "D2",
    naam: "Hoog personeelsverloop",
    gewicht: {
      herposte_vacatures: 30,
      negatieve_reviews_chaos: 35,
      arbeidsrechtzaak_patroon: 40,
      arbeidsrechtzaak_recent: 20,
    },
  },
  {
    code: "D3",
    naam: "Onvoldoende flexibiliteit in personeelsinzet",
    gewicht: {
      seizoenspieken: 40,
      veel_freelancers: 30,
      klein_team_in_groei: 20,
    },
  },
  {
    code: "D4",
    naam: "Hulp bij (langdurig) verzuim",
    gewicht: {
      verzuim_burnout_signalen: 45,
      arbo_boete_recent: 30,
      arbeidsinspectie_stillegging: 35,
    },
  },
  {
    code: "D5",
    naam: "Hulp bij regelgeving/afspraken",
    gewicht: {
      arbo_boete_recent: 40,
      arbeidsinspectie_stillegging: 45,
      asbest_overtreding: 30,
      arbeidsrechtzaak_recent: 25,
      nieuwe_bv: 15,
    },
  },
  {
    code: "D6",
    naam: "Gebrek aan tijd en kennis voor personeelszaken",
    gewicht: {
      geen_hr_rol_zichtbaar: 40,
      founder_run: 35,
      geen_hr_finance_roles: 35,
      klein_team_in_groei: 20,
      snelle_groei: 20,
    },
  },
  {
    code: "D7",
    naam: "Onduidelijk personeelsbeleid",
    gewicht: {
      veel_functies_geen_structuur: 40,
      geen_hr_rol_zichtbaar: 25,
      nieuwe_managementlaag: 25,
      internationale_uitbreiding: 15,
    },
  },
  {
    code: "D8",
    naam: "Hulp bij leidinggeven aan personeel",
    gewicht: {
      nieuwe_managementlaag: 40,
      negatieve_reviews_chaos: 30,
      veel_functies_geen_structuur: 25,
      verzuim_burnout_signalen: 20,
    },
  },
  // D9-D13 — PAVO product-portfolio (HR-Quickscan, Functiehuis, etc.).
  // Pain-point bewoording aangehouden in lijn met D1-D8 zodat de UI
  // consistent blijft. Definitieve dienst-namen + zwaartes mogen
  // bijgesteld worden zodra Roy de matrix afkust.
  {
    code: "D9",
    naam: "Functie- en salarishuis op orde",
    gewicht: {
      veel_functies_geen_structuur: 35,
      nieuwe_managementlaag: 25,
      snelle_groei: 20,
      internationale_uitbreiding: 15,
    },
  },
  {
    code: "D10",
    naam: "Salarisadministratie uit handen",
    gewicht: {
      loonadministratie_klachten: 45,
      founder_run: 25,
      geen_hr_finance_roles: 25,
      veel_freelancers: 15,
    },
  },
  {
    code: "D11",
    naam: "Verzuimreglement en preventie",
    gewicht: {
      verzuim_burnout_signalen: 40,
      arbo_boete_recent: 30,
      arbeidsinspectie_stillegging: 30,
      negatieve_reviews_chaos: 15,
    },
  },
  {
    code: "D12",
    naam: "Risico-Inventarisatie & Evaluatie (RI&E)",
    gewicht: {
      arbeidsinspectie_stillegging: 45,
      arbo_boete_recent: 40,
      asbest_overtreding: 35,
      verzuim_burnout_signalen: 15,
    },
  },
  {
    code: "D13",
    naam: "Gesprekscyclus + personeelshandboek",
    gewicht: {
      veel_functies_geen_structuur: 30,
      geen_hr_rol_zichtbaar: 25,
      negatieve_reviews_chaos: 20,
      arbeidsrechtzaak_recent: 20,
      arbeidsrechtzaak_patroon: 20,
    },
  },
];
