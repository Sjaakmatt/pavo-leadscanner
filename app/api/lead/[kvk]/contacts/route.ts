import { NextResponse } from "next/server";
import { tryGetSupabase } from "@/lib/supabase/client";
import { fetchContacts } from "@/lib/lead-source/contacts";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kvk: string }> },
) {
  const { kvk } = await params;
  const supabase = tryGetSupabase();
  if (!supabase) {
    return NextResponse.json({ contacts: [] });
  }
  const contacts = await fetchContacts(supabase, kvk);
  return NextResponse.json({ contacts });
}
