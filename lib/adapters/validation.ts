import { z } from "zod";
import type { SearchFilters } from "./types";

const fteKlasseSchema = z.enum(["10-19", "20-49", "50-99", "100-199"]);

const latLngSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

export const searchFiltersSchema = z.object({
  fte_klassen: z.array(fteKlasseSchema).max(4).default([]),
  branche: z.string().trim().min(1).max(120),
  regio_center: latLngSchema.nullable().default(null),
  regio_straal_km: z.number().finite().min(1).max(250).default(25),
  signaal_query: z.string().trim().max(240).default(""),
  max_basisprofielen: z.number().int().min(1).max(1000).optional(),
});

export function parseSearchFilters(input: unknown): SearchFilters {
  return searchFiltersSchema.parse(input) as SearchFilters;
}

export function validationErrorMessage(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
  }
  return "Ongeldige request body";
}
