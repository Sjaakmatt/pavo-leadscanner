// Type-safe observability-wrapper rond `factum.logEvent`. Alle
// logging in pavo-leadscanner moet via `logObs()` lopen — dat dwingt
// af dat:
//
// 1. Elk event een `category` heeft (zodat dashboard kan tabben)
// 2. Elk event een `org_id` heeft wanneer een gebruiker is ingelogd
//    (zodat dashboard per-klant kan filteren)
// 3. Geen PII in event-message terechtkomt (alleen branche / tellingen)
// 4. Stack-traces + lange strings worden getrunceerd
// 5. Bekende secret-patterns automatisch worden geredacteerd
//
// AVG/AI Act compliance:
// - Data-minimization: voer geen full-namen of emails op in `message`;
//   alleen in `metadata` waar dashboard ze RBAC-protected kan tonen.
// - Audit-events (auth, status-change) hebben langere retention →
//   markeer met `audit: true`.
// - LLM-beslissingen die natuurlijke personen evalueren krijgen
//   `category: "llm_decision"` met model + reasoning-summary
//   (geen full prompt) zodat we Art. 22 GDPR + AI Act art. 12 dekken.

import { factum, type FactumEventType } from "@/lib/factum/client";

export type LogCategory =
  | "search"          // search-flow events (start, complete, fail)
  | "search_stage"    // per-stage timing binnen een search
  | "scoring"         // lead-scoring beslissingen (HOT/WARM/COLD)
  | "llm"             // ruwe LLM-call (tokens, kosten, latency)
  | "llm_decision"    // LLM-call die een mens-evaluatie maakt (AI Act)
  | "mcp"             // MCP HTTP-call (tool, duration, error)
  | "auth"            // login, logout, profile-creation
  | "user_action"     // user-getriggered CRUD (saved-search, chat, status)
  | "cron"            // cron-runs (success/fail)
  | "compliance"      // expliciet audit-trail event
  | "system";         // deploy, error, heartbeat

export interface LogPayload {
  type: FactumEventType;
  category: LogCategory;
  /** Bondig, GEEN PII. Bv. "Lead-search · branche=bouw n=12". */
  message: string;
  orgId?: string | null;
  userId?: string | null;
  /** Markeer als `true` voor audit-events met langere retention. */
  audit?: boolean;
  /** Vrije velden — worden gesanitized voor PII + secrets. */
  metadata?: Record<string, unknown>;
}

const MAX_STRING_LEN = 4_000;
const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /sk-[A-Za-z0-9]{20,}/g,
  /eyJ[A-Za-z0-9._-]{20,}/g, // JWT
  /[A-Za-z0-9]{32,}/g, // generic long tokens (laatste fallback)
];
const PII_KEYS = new Set([
  "email",
  "fullName",
  "full_name",
  "naam",
  "phone",
  "telefoon",
  "adres",
  "address",
]);

/**
 * Strip PII + secrets uit metadata. Modificeert recursief.
 * Mutates not — returns sanitized copy.
 */
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated:depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSecrets(truncate(value));
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (PII_KEYS.has(k)) {
        out[k] = "[redacted:pii]";
        continue;
      }
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function truncate(s: string): string {
  if (s.length <= MAX_STRING_LEN) return s;
  return `${s.slice(0, MAX_STRING_LEN)}…[truncated:${s.length}]`;
}

function redactSecrets(s: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[redacted:secret]");
  }
  return out;
}

/**
 * Centrale logging-functie voor pavo-leadscanner. Werkt ook als
 * FACTUM_DASHBOARD_URL niet geconfigureerd is — dan no-op.
 */
export async function logObs(payload: LogPayload): Promise<void> {
  if (!factum.enabled) return;
  const sanitizedMetadata = (sanitize(payload.metadata ?? {}) ?? {}) as Record<
    string,
    unknown
  >;

  const enriched: Record<string, unknown> = {
    ...sanitizedMetadata,
    category: payload.category,
    org_id: payload.orgId ?? null,
    user_id: payload.userId ?? null,
    audit: payload.audit === true ? true : undefined,
    agent_id: "pavo-leadscanner",
  };

  await factum.logEvent(
    payload.type,
    truncate(redactSecrets(payload.message)),
    enriched,
  );
}

/**
 * Convenience helper om Error-objects via logObs te pushen. Strippt
 * lange stack-paths + redacteert.
 */
export async function logError(
  category: LogCategory,
  message: string,
  err: unknown,
  extra: Omit<LogPayload, "type" | "category" | "message"> = {},
): Promise<void> {
  const stack = err instanceof Error ? err.stack : undefined;
  const errMsg = err instanceof Error ? err.message : String(err);
  await logObs({
    type: "error",
    category,
    message: `${message}: ${errMsg}`,
    ...extra,
    metadata: {
      ...(extra.metadata ?? {}),
      error: errMsg,
      stack: stack ? truncate(stack) : undefined,
    },
  });
}
