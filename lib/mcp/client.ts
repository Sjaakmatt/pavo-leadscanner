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

import type { ZodSchema } from "zod";

export type TenantContext = {
  organizationId: string;
  agentId: string;
  toolCallId: string;
  parentCallId?: string;
};

export class McpCallError extends Error {
  readonly toolName?: string;
  constructor(message: string, toolName?: string) {
    super(message);
    this.name = "McpCallError";
    this.toolName = toolName;
  }
}

type McpTextBlock = { type: "text"; text: string };

function isTextBlock(b: unknown): b is McpTextBlock {
  if (typeof b !== "object" || b === null) return false;
  const obj = b as { type?: unknown; text?: unknown };
  return obj.type === "text" && typeof obj.text === "string";
}

export class McpHttpClient {
  private sessionId: string | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly clientName = "pavo-leadscanner",
  ) {}

  async callTool<T>(
    toolName: string,
    tenantContext: TenantContext,
    args: Record<string, unknown>,
    responseSchema: ZodSchema<T>,
  ): Promise<T> {
    await this.ensureInitialized();
    const response = await fetch(this.baseUrl, {
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

    if (!response.ok) {
      throw new McpCallError(
        `MCP ${toolName} faalde: ${response.status} ${await safeText(response)}`,
        toolName,
      );
    }

    const json = await parseJsonRpc(response);
    if (json.error) {
      throw new McpCallError(json.error.message ?? "MCP error", toolName);
    }

    const blocks = json.result?.content;
    if (!Array.isArray(blocks) || blocks.length === 0) {
      throw new McpCallError("Geen content in MCP-response", toolName);
    }
    // `blocks` is unknown[] — de predicate moet tegen `unknown` smallen,
    // anders weigert tsc 'm te koppelen aan Array.find. isTextBlock
    // doet de runtime-check + de typing.
    const textBlock = blocks.find(isTextBlock);
    if (!textBlock) {
      throw new McpCallError("Geen text-block in MCP-response", toolName);
    }
    // MCP-tools die falen retourneren `{isError: true, content:[{text: "..."}]}`
    // met een plain-text error message — geen JSON. Surface de tekst zodat
    // upstream issues (bv. KvK 520) niet als "Ongeldige JSON" verschijnen.
    if (json.result?.isError === true) {
      throw new McpCallError(textBlock.text || "MCP tool error", toolName);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch (err) {
      throw new McpCallError(
        `Ongeldige JSON in MCP-response: ${String(err)}`,
        toolName,
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
  result?: { content?: unknown[]; isError?: boolean };
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
