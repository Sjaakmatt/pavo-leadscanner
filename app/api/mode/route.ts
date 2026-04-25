import { NextResponse } from "next/server";
import { currentMode } from "@/lib/lead-source";

// Readonly endpoint voor de UI — toont welke mode actief is + of de
// FactumAI MCP-endpoints geconfigureerd zijn. Geen andere env-waarden
// expose'n; dit is alleen dev-diagnostiek voor de mode-badge.
export async function GET() {
  const mode = currentMode();
  const mcpConfigured =
    !!process.env.FACTUMAI_MCP_BEDRIJVEN_URL &&
    !!process.env.FACTUMAI_MCP_WEBSCRAPER_URL;
  return NextResponse.json({ mode, mcpConfigured });
}
