// FactumAI dashboard client. Stuurt heartbeats, events en optionele
// daily metrics naar het FactumAI-dashboard. Alle calls zijn no-op als
// FACTUM_DASHBOARD_URL of FACTUM_API_KEY ontbreekt — demo-mode draait
// dus zonder enige extra config.
//
// API-spec: docs/AGENT-INTEGRATION.md in factumai-dashboard.

export type FactumEventType =
  | "task_completed"
  | "task_failed"
  | "escalation"
  | "error"
  | "warning"
  | "info"
  | "deploy"
  | "activity_summary";

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

const REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_HEARTBEAT_MS = 60_000;

class FactumClient {
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;

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
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
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
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat();
    }, interval);
    // Niet de Node-event-loop blokkeren tijdens shutdown.
    this.heartbeatTimer.unref?.();
  }

  async heartbeat(
    status: "online" | "offline" | "degraded" = "online",
  ): Promise<void> {
    await this.request("/api/v1/ingest/heartbeat", { status });
  }

  async logEvent(
    type: FactumEventType,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.request("/api/v1/ingest/event", { type, message, metadata });
  }

  async pushMetrics(metrics: FactumMetrics): Promise<void> {
    const date = metrics.date ?? new Date().toISOString().slice(0, 10);
    await this.request("/api/v1/ingest/metrics", { ...metrics, date });
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
