import { NextResponse } from "next/server";
import { currentMode } from "@/lib/lead-source";

// Readonly endpoint zodat de UI kan tonen welke mode actief is. We
// exposen geen andere env-waarden — alleen "demo" of "prod" + een vlag
// dat de KvK-client in mock-modus draait (voor prod-mode zonder key).
export async function GET() {
  const mode = currentMode();
  const kvkMock = !process.env.KVK_API_KEY || /placeholder/i.test(process.env.KVK_API_KEY);
  return NextResponse.json({ mode, kvkMock });
}
