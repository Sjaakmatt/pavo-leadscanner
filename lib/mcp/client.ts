// MCP Streamable HTTP client. Houdt session-id state per instance,
// JSON-RPC POST + accept: application/json, text/event-stream.
//
// Eén instance per MCP-server. ProductionLeadSource heeft er twee:
// bedrijvenClient (8110) en webscraperClient (8111).

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
  private initPromise: Promise<string> | null = null;

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
    const sessionId = await this.ensureSession();
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
      },
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

  private ensureSession(): Promise<string> {
    if (this.sessionId) return Promise.resolve(this.sessionId);
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initialize().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async initialize(): Promise<string> {
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
    const sessionId = response.headers.get("mcp-session-id");
    if (!sessionId) {
      throw new McpCallError("Geen mcp-session-id in initialize-response");
    }
    this.sessionId = sessionId;

    // notifications/initialized — MCP-spec voorschrift; sommige servers
    // weigeren tools/call zonder deze notificatie. Best-effort.
    await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }),
    }).catch(() => undefined);

    return sessionId;
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
