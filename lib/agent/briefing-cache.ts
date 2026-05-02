// Persistent cache voor lead-briefings. Eén row per KvK; row wordt
// vervangen wanneer de signals_hash niet meer matcht (nieuwe scan met
// andere/meer signalen). Voorkomt onnodige Anthropic-calls op /lead-
// pagina-opens.
//
// Invalidatie is data-driven, niet TTL: zolang de lead-inputs (signalen,
// archetype, dienstmatch, observatie) hetzelfde zijn, is de briefing
// cache-hit. Een verse scan vult nieuwe signalen → nieuwe hash → cache
// wordt overschreven bij eerstvolgende open.
//
// Demo-mode (geen Supabase configured): alle calls zijn no-op zodat de
// briefing-route gewoon werkt zonder cache.

import { createHash } from "node:crypto";
import type { Lead } from "@/lib/adapters/types";
import { tryGetSupabase } from "@/lib/supabase/client";

export interface CachedBriefing {
  kvk: string;
  briefing_md: string;
  signals_hash: string;
  model: string;
  generated_at: string;
}

/**
 * Stable hash over alle inputs die de briefing-prompt feitelijk gebruikt.
 * Sortert eerst zodat insertion-volgorde van signalen geen mismatch
 * triggert.
 */
export function hashLeadInputs(lead: Lead): string {
  const sigTxt = lead.signalen
    .map((s) => `${s.bron}:${s.tekst}`)
    .sort()
    .join("|");
  const dienst = lead.diensten
    .map((d) => `${d.code}:${d.score}`)
    .sort()
    .join("|");
  const arch = lead.archetype?.code ?? "-";
  const obs = lead.observatie ?? "-";
  return createHash("sha256")
    .update(`${arch}|${sigTxt}|${dienst}|${obs}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Probeer een cached briefing op te halen. Returnt null bij cache-miss,
 * hash-mismatch of als Supabase niet beschikbaar is (demo-mode).
 */
export async function loadCachedBriefing(
  kvk: string,
  expectedHash: string,
): Promise<CachedBriefing | null> {
  const supabase = tryGetSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("lead_briefings")
    .select("kvk, briefing_md, signals_hash, model, generated_at")
    .eq("kvk", kvk)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as CachedBriefing;
  if (row.signals_hash !== expectedHash) return null;
  return row;
}

/**
 * Persist (upsert) een verse briefing. Best-effort: faalt deze write
 * stilletjes, dan loopt de chat-pipeline door — volgende open probeert
 * gewoon opnieuw.
 */
export async function saveCachedBriefing(
  kvk: string,
  briefingMd: string,
  signalsHash: string,
  model: string,
): Promise<void> {
  const supabase = tryGetSupabase();
  if (!supabase) return;
  if (briefingMd.length === 0) return;

  await supabase
    .from("lead_briefings")
    .upsert(
      {
        kvk,
        briefing_md: briefingMd,
        signals_hash: signalsHash,
        model,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "kvk" },
    );
}
