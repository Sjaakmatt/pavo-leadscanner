// FactumAI dashboard client. Stuurt heartbeats, events en optionele
// daily metrics naar het FactumAI-dashboard. Alle calls zijn no-op als
// FACTUM_DASHBOARD_URL of FACTUM_API_KEY ontbreekt — demo-mode draait
// dus zonder enige extra config.
//
// API-spec: docs/AGENT-INTEGRATION.md in factumai-dashboard.
//
// Fase 1 toevoeging: events kunnen nu een `category` en `audit` flag
// meekrijgen bovenop het bestaande type/message contract. Het dashboard
// gebruikt die om events te filteren per tab (search/llm/mcp/...) en om
// per-row TTL-retention toe te passen (zie OBSERVABILITY.md §3 + §6).
// Concrete invoer loopt via `lib/observability/logger.ts::logObs`.

export type FactumEventType =
  | "task_completed"
  | "task_failed"
  | "escalation"
  | "error"
  | "warning"
  | "info"
  | "deploy"
  | "activity_summary";

// Spiegel van EVENT_CATEGORIES in factumai-dashboard. Ongeldige waardes
// worden door de ingest geweigerd (HTTP 400) op /api/v1/ingest/event.
export type FactumEventCategory =
  | "search"
  | "search_stage"
  | "scoring"
  | "llm"
  | "llm_decision"
  | "mcp"
  | "auth"
  | "user_action"
  | "cron"
  | "compliance"
  | "system";

export interface FactumLogOptions {
  category?: FactumEventCategory;
  audit?: boolean;
}

type ConnectMeta = {
  version?: string;
  hostname?: string;
  runtime?: string;
};

type ConnectResponse = {
  config?: { heartbeatIntervalMs?: number };
};

export type FactumMetrics = {
  date?: string;
  tasksCompleted?: number;
  tasksFailed?: number;
  avgResponseTimeMs?: number;
  totalTokensUsed?: number;
  estimatedTimeSavedMinutes?: number;
  estimatedCostSavedEur?: number;
  automationRate?: number;
  humanEscalations?: number;
};

export type FactumHeartbeat = {
  status?: "online" | "offline" | "degraded";
  responseTimeMs?: number;
  message?: string;
};

export type FactumBatchEvent = {
  type: FactumEventType;
  category?: FactumEventCategory;
  audit?: boolean;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
};

export type FactumBatch = {
  heartbeat?: FactumHeartbeat;
  events?: FactumBatchEvent[];
  metrics?: FactumMetrics;
};

const REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_HEARTBEAT_MS = 60_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;

class FactumClient {
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private rateLimitedUntil = 0;

  constructor() {
    const raw = process.env.FACTUM_DASHBOARD_URL ?? "";
    this.baseUrl = raw.replace(/\/$/, "") || null;
    this.apiKey = process.env.FACTUM_API_KEY || null;
  }

  get enabled(): boolean {
    return !!this.baseUrl && !!this.apiKey;
  }

  private async request(path: string, body?: unknown): Promise<Response | null> {
    if (!this.enabled) return null;
    if (Date.now() < this.rateLimitedUntil) return null;
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 429) {
        this.rateLimitedUntil = Date.now() + readRetryAfterMs(res);
        console.warn(
          `[factum] ${path} rate-limited; pauzeert dashboard-calls tot ${new Date(this.rateLimitedUntil).toISOString()}`,
        );
      }
      return res;
    } catch (err) {
      console.warn(`[factum] ${path} failed: ${String(err)}`);
      return null;
    }
  }

  async connect(meta: ConnectMeta = {}): Promise<void> {
    if (!this.enabled || this.connected) return;
    const res = await this.request("/api/v1/agent/connect", meta);
    if (!res || !res.ok) return;
    this.connected = true;

    const data = (await res.json().catch(() => ({}))) as ConnectResponse;
    const interval = data.config?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
    if (shouldStartIntervalHeartbeat()) {
      this.heartbeatTimer = setInterval(() => {
        void this.heartbeat();
      }, interval);
      // Niet de Node-event-loop blokkeren tijdens shutdown.
      this.heartbeatTimer.unref?.();
    }
  }

  async heartbeat(
    status: "online" | "offline" | "degraded" = "online",
  ): Promise<void> {
    await this.request("/api/v1/ingest/heartbeat", { status });
  }

  /**
   * Log een event richting het dashboard. `options.category` en
   * `options.audit` worden top-level meegestuurd (niet in metadata),
   * zodat de dashboard ingest ze direct kan promoveren naar kolommen
   * + per-row TTL kan zetten. Legacy callers zonder options blijven
   * werken — die landen dan onder `category = NULL` met 90d default-TTL.
   */
  async logEvent(
    type: FactumEventType,
    message: string,
    metadata?: Record<string, unknown>,
    options: FactumLogOptions = {},
  ): Promise<void> {
    const body: Record<string, unknown> = { type, message, metadata };
    if (options.category) body.category = options.category;
    if (options.audit) body.audit = true;
    await this.request("/api/v1/ingest/event", body);
  }

  async pushMetrics(metrics: FactumMetrics): Promise<void> {
    const date = metrics.date ?? new Date().toISOString().slice(0, 10);
    await this.request("/api/v1/ingest/metrics", { ...metrics, date });
  }

  // Combineert heartbeat + events + metrics in één POST. Gebruikt door
  // de Vercel-cron (zie app/api/cron/factum-sync) zodat we per tick één
  // outbound call hebben in plaats van drie.
  async sendBatch(batch: FactumBatch): Promise<void> {
    const payload: FactumBatch = { ...batch };
    if (payload.metrics && !payload.metrics.date) {
      payload.metrics = {
        ...payload.metrics,
        date: new Date().toISOString().slice(0, 10),
      };
    }
    await this.request("/api/v1/ingest/batch", payload);
  }

  async disconnect(reason?: string): Promise<void> {
    if (!this.enabled || !this.connected) return;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.connected = false;
    await this.request(
      "/api/v1/agent/disconnect",
      reason ? { reason } : {},
    );
  }
}

function readRetryAfterMs(res: Response): number {
  const header = res.headers.get("retry-after");
  if (!header) return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(1_000, seconds * 1_000);
  }
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.max(1_000, date - Date.now());
  }
  return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}

function shouldStartIntervalHeartbeat(): boolean {
  if (process.env.FACTUM_ENABLE_INTERVAL_HEARTBEAT === "true") return true;
  if (process.env.FACTUM_ENABLE_INTERVAL_HEARTBEAT === "false") return false;
  return !process.env.VERCEL;
}

declare global {
  // eslint-disable-next-line no-var
  var __factumClient: FactumClient | undefined;
}

// Singleton — Next.js dev-mode hergebruikt deze over HMR-reloads zodat
// we geen dubbele heartbeat-timers stapelen.
const client: FactumClient = globalThis.__factumClient ?? new FactumClient();
if (process.env.NODE_ENV !== "production") {
  globalThis.__factumClient = client;
}

export const factum = client;
