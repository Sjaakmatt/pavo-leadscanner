// Wachtwoord-reset API. User vult email in op /login → POST hier →
// Supabase stuurt de "Reset Password"-email (recovery.html template)
// met OTP-code → user gaat naar /auth/set-password?type=recovery
//
// Server-side aangezien `resetPasswordForEmail` zonder admin-key kan,
// maar we willen de redirectTo-URL beheren en spam-rate-limit kunnen
// toevoegen later. Returnt altijd success — voorkom email-enumeration.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "Geldige e-mail vereist" },
      { status: 400 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: "Auth uit" }, { status: 503 });
  }

  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  const redirectTo = origin
    ? `${origin}/auth/set-password?type=recovery&email=${encodeURIComponent(email)}`
    : undefined;

  const supabase = createClient(supabaseUrl, anonKey);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });
  if (error) {
    console.warn(`[forgot-password] ${email}: ${error.message}`);
  }

  // Altijd success retourneren — voorkomt dat een aanvaller via
  // verschil in response kan checken of een email-adres bestaat.
  return NextResponse.json({ ok: true });
}
