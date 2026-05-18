// MCP Streamable HTTP client. Houdt session-id state per instance,
// JSON-RPC POST + accept: application/json, text/event-stream.
//
// Eén instance per MCP-server. ProductionLeadSource heeft er vier:
// mcp-bedrijven (8110), mcp-vacatures (8120), mcp-news (8121),
// mcp-juridisch (8122).
//
// Stateless servers: de MCP Streamable HTTP-spec staat servers toe om
// GEEN Mcp-Session-Id terug te geven op initialize. Dan draaien we
// gewoon zonder session-id en sturen we 'm niet mee in tools/call.
//
// Resilience:
//   - Retry: idempotent tools/call met expo-backoff op 5xx en netwerk-
//     errors (max 2 retries, totaal max ~3s extra latency).
//   - Circuit breaker: 5 opeenvolgende failures binnen 30s → break;
//     vervolgens 60s open en daarna half-open (1 probe).
//   - RPS-throttle: per-instance token-bucket zodat parallel werkers
//     niet meer dan N calls/sec naar dezelfde MCP-server schieten.
//     Beschermt vooral mcp-bedrijven tegen KvK's harde 3 rps quota.

import type { ZodSchema } from "zod";

export type TenantContext = {
  organizationId: string;
  agentId: string;
  toolCallId: string;
  parentCallId?: string;
};

export class McpCallError extends Error {
  readonly toolName?: string;
  readonly retryable: boolean;
  constructor(message: string, toolName?: string, retryable = false) {
    super(message);
    this.name = "McpCallError";
    this.toolName = toolName;
    this.retryable = retryable;
  }
}

const RETRY_MAX_ATTEMPTS = 3; // 1 first try + 2 retries
const RETRY_BASE_MS = 250;
const BREAKER_FAILURE_THRESHOLD = 5;
const BREAKER_OPEN_MS = 60_000;
const BREAKER_WINDOW_MS = 30_000;

type BreakerState = "closed" | "open" | "half-open";

class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures: number[] = [];
  private openedAt = 0;

  shouldAllow(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "open") {
      if (Date.now() - this.openedAt >= BREAKER_OPEN_MS) {
        this.state = "half-open";
        return true; // probe
      }
      return false;
    }
    // half-open — laat één call door; openSuccess/onFailure regelen state
    return true;
  }

  onSuccess(): void {
    this.state = "closed";
    this.failures = [];
  }

  onFailure(): void {
    const now = Date.now();
    this.failures = [
      ...this.failures.filter((t) => now - t < BREAKER_WINDOW_MS),
      now,
    ];
    if (this.failures.length >= BREAKER_FAILURE_THRESHOLD) {
      this.state = "open";
      this.openedAt = now;
    }
  }
}

function isRetryableHttp(status: number): boolean {
  return status === 429 || status >= 500;
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Token-bucket rate-limiter — refilled bij elke acquire op basis van
// verstreken tijd. Doel: gemiddeld ≤ ratePerSec calls/sec; korte burst
// tot `burst` tokens. Volgorde is FIFO via een wait-queue zodat een
// hammered instance niet één worker laat verhongeren.
class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }

  async acquire(): Promise<void> {
    if (this.ratePerSec <= 0) return; // throttle disabled
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      // Wacht tot we minstens 1 token verdiend hebben.
      const ms = Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          const idx = this.waiters.indexOf(resolve);
          if (idx !== -1) this.waiters.splice(idx, 1);
          resolve();
        }, ms);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSec);
    this.lastRefill = now;
  }
}

type McpTextBlock = { type: "text"; text: string };

function isTextBlock(b: unknown): b is McpTextBlock {
  if (typeof b !== "object" || b === null) return false;
  const obj = b as { type?: unknown; text?: unknown };
  return obj.type === "text" && typeof obj.text === "string";
}

export type McpHttpClientOptions = {
  /**
   * Max calls per seconde (gemiddeld) naar deze MCP-instance.
   * `0` = throttle uit (default voor tests). Productie zet dit per
   * MCP — KvK heeft een 3 rps quota, dus mcp-bedrijven krijgt
   * `ratePerSec: 3`.
   */
  ratePerSec?: number;
  /**
   * Aantal tokens dat we mogen burst-en boven `ratePerSec`. Default
   * gelijk aan `ratePerSec` (≈ 1s aan calls in één keer toegestaan).
   */
  burst?: number;
};

export class McpHttpClient {
  private sessionId: string | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private readonly breaker = new CircuitBreaker();
  private readonly limiter: RateLimiter;

  constructor(
    private readonly baseUrl: string,
    private readonly clientName = "pavo-leadscanner",
    opts: McpHttpClientOptions = {},
  ) {
    const rate = opts.ratePerSec ?? 0;
    const burst = opts.burst ?? Math.max(1, rate);
    this.limiter = new RateLimiter(rate, burst);
  }

  async callTool<T>(
    toolName: string,
    tenantContext: TenantContext,
    args: Record<string, unknown>,
    responseSchema: ZodSchema<T>,
  ): Promise<T> {
    if (!this.breaker.shouldAllow()) {
      throw new McpCallError(
        `MCP ${toolName} circuit-breaker open — server is degraded`,
        toolName,
        false,
      );
    }
    let lastErr: unknown;
    for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.attemptCallTool(
          toolName,
          tenantContext,
          args,
          responseSchema,
        );
        this.breaker.onSuccess();
        return result;
      } catch (err) {
        lastErr = err;
        const retryable =
          err instanceof McpCallError ? err.retryable : true; // fetch-errors
        if (!retryable || attempt === RETRY_MAX_ATTEMPTS) break;
        // Expo-backoff met jitter zodat parallel werkers niet sync-hammeren.
        const wait = RETRY_BASE_MS * 2 ** (attempt - 1);
        await delay(wait + Math.floor(Math.random() * 100));
      }
    }
    this.breaker.onFailure();
    throw lastErr;
  }

  private async attemptCallTool<T>(
    toolName: string,
    tenantContext: TenantContext,
    args: Record<string, unknown>,
    responseSchema: ZodSchema<T>,
  ): Promise<T> {
    await this.ensureInitialized();
    await this.limiter.acquire();
    let response: Response;
    try {
      response = await fetch(this.baseUrl, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: randomId(),
          method: "tools/call",
          params: {
            name: toolName,
            arguments: { tenantContext, ...args },
          },
        }),
      });
    } catch (err) {
      // Netwerk-laag: connection-reset, DNS, timeout — altijd retryable
      throw new McpCallError(
        `MCP ${toolName} netwerk-fout: ${String(err)}`,
        toolName,
        true,
      );
    }

    if (!response.ok) {
      throw new McpCallError(
        `MCP ${toolName} faalde: ${response.status} ${await safeText(response)}`,
        toolName,
        isRetryableHttp(response.status),
      );
    }

    const json = await parseJsonRpc(response);
    if (json.error) {
      throw new McpCallError(
        json.error.message ?? "MCP error",
        toolName,
        false,
      );
    }

    const blocks = json.result?.content;
    if (!Array.isArray(blocks) || blocks.length === 0) {
      throw new McpCallError("Geen content in MCP-response", toolName, false);
    }
    // `blocks` is unknown[] — de predicate moet tegen `unknown` smallen,
    // anders weigert tsc 'm te koppelen aan Array.find. isTextBlock
    // doet de runtime-check + de typing.
    const textBlock = blocks.find(isTextBlock);
    if (!textBlock) {
      throw new McpCallError("Geen text-block in MCP-response", toolName, false);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch (err) {
      throw new McpCallError(
        `Ongeldige JSON in MCP-response: ${String(err)}`,
        toolName,
        false,
      );
    }
    return responseSchema.parse(parsed);
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.sessionId) {
      headers["mcp-session-id"] = this.sessionId;
    }
    return headers;
  }

  private ensureInitialized(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initialize().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomId(),
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: this.clientName, version: "0.1.0" },
        },
      }),
    });

    if (!response.ok) {
      throw new McpCallError(
        `MCP initialize faalde: ${response.status} ${await safeText(response)}`,
      );
    }

    // Session-id is OPTIONEEL in de Streamable HTTP-spec. Stateless
    // servers (zoals de huidige FactumAI MCPs) geven 'm niet terug —
    // we draaien dan zonder session-id en sturen 'm niet mee.
    this.sessionId = response.headers.get("mcp-session-id");
    this.initialized = true;

    // notifications/initialized — MCP-spec voorschrift; sommige servers
    // weigeren tools/call zonder deze notificatie. Best-effort.
    await fetch(this.baseUrl, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }),
    }).catch(() => undefined);
  }
}

// MCP Streamable HTTP kan zowel application/json als text/event-stream
// retourneren voor JSON-RPC responses. We accepteren beide.
async function parseJsonRpc(response: Response): Promise<{
  result?: { content?: unknown[] };
  error?: { message?: string };
}> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice("data:".length).trim();
      if (!data) continue;
      try {
        return JSON.parse(data);
      } catch {
        continue;
      }
    }
    throw new McpCallError("Geen data-event in SSE-stream");
  }
  return response.json();
}

async function safeText(r: Response): Promise<string> {
  try {
    return await r.text();
  } catch {
    return "";
  }
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
