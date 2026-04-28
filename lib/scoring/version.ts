// Scoring-versie. Bumpen bij iedere wijziging in:
//   - CLUSTER_POINTS in lib/scoring/index.ts
//   - DIENSTEN_MATRIX in lib/scoring/diensten-matrix.ts
//   - combinationOverride / inferArchetype regels
//   - recency-decay parameters
//
// Wordt op `scored_leads.scoring_version` gepersisteerd zodat oude
// runs niet vergeleken worden met nieuwe weights.

export const SCORING_VERSION = "2026.04-recency-d13";
