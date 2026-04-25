// TenantContext-builder. Productie-flow vereist de drie env-vars; demo
// raakt deze module nooit. Eén toolCallId per individuele MCP-aanroep,
// parentCallId voor traceability binnen één search-run.

import type { TenantContext } from "./client";

export function requireTenantEnv(): { organizationId: string; agentId: string } {
  const organizationId = process.env.FACTUMAI_ORGANIZATION_ID;
  const agentId = process.env.FACTUMAI_AGENT_ID;
  if (!organizationId || !agentId) {
    throw new Error(
      "FACTUMAI_ORGANIZATION_ID en FACTUMAI_AGENT_ID zijn verplicht voor MCP-aanroepen.",
    );
  }
  return { organizationId, agentId };
}

export function buildTenantContext(opts: {
  parentCallId?: string;
} = {}): TenantContext {
  const { organizationId, agentId } = requireTenantEnv();
  return {
    organizationId,
    agentId,
    toolCallId: randomId(),
    parentCallId: opts.parentCallId,
  };
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
