"use client";

// Login-flow: email + password (primair). "Wachtwoord vergeten?"
// triggert een OTP-recovery email; user gaat naar /auth/set-password.
//
// Nieuwe gebruikers worden uitgenodigd door admins via /users → krijgen
// een invite-email met OTP-code → /auth/set-password?type=invite om
// initial password te zetten.
//
// Geen klikbare magic-link in emails — corporate email-scanners zoals
// Defender Safe Links pre-klikken die en consumeren tokens. OTP-flow
// werkt 100% over alle email-clients.

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  authConfiguredOnClient,
  supabaseBrowserClient,
} from "@/lib/auth/browser";

type Status = "idle" | "submitting" | "error";
type ResetStatus = "idle" | "sending" | "sent" | "error";

export default function LoginPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <LoginForm />
    </Suspense>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-md flex-col justify-center px-4 py-12">
      <div className="h-72 animate-pulse rounded-lg border border-pavo-gray-100 bg-white" />
    </div>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const from = params.get("from") ?? "/";
  const initialError = params.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(initialError);

  // Forgot-password subform
  const [resetVisible, setResetVisible] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetStatus, setResetStatus] = useState<ResetStatus>("idle");
  const [resetError, setResetError] = useState<string | null>(null);

  const authOn = authConfiguredOnClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!authOn || status === "submitting") return;
    setStatus("submitting");
    setError(null);

    try {
      const supabase = supabaseBrowserClient();
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err) throw err;
      window.location.href = from;
    } catch (err) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      // Vriendelijkere foutmelding voor 'Invalid login credentials'
      if (/invalid login credentials/i.test(msg)) {
        setError(
          "E-mail of wachtwoord onjuist. Geen account? Vraag je admin om je uit te nodigen.",
        );
      } else {
        setError(msg);
      }
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (resetStatus === "sending") return;
    const target = resetEmail.trim();
    if (!target.includes("@")) {
      setResetError("Geldige e-mail vereist.");
      setResetStatus("error");
      return;
    }
    setResetStatus("sending");
    setResetError(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Status ${res.status}`);
      }
      setResetStatus("sent");
    } catch (err) {
      setResetStatus("error");
      setResetError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-lg border border-pavo-gray-100 bg-white p-6 shadow-sm md:p-8">
        <h1 className="text-xl font-semibold tracking-tight text-pavo-navy">
          Log in op PAVO Research Agent
        </h1>
        <p className="mt-2 text-sm text-pavo-gray-600">
          Vul je e-mail en wachtwoord in. Heb je nog geen wachtwoord?
          Vraag je beheerder om een uitnodiging.
        </p>

        {!authOn && (
          <div className="mt-5 rounded-lg border border-pavo-orange/30 bg-pavo-orange/5 px-4 py-3 text-sm text-pavo-gray-900">
            Auth staat uit (geen Supabase env-config). De app draait open
            in demo-modus.
          </div>
        )}

        {authOn && !resetVisible && (
          <form onSubmit={handleLogin} className="mt-5 space-y-3">
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
                E-mail
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="naam@bedrijf.nl"
                disabled={status === "submitting"}
                autoComplete="email"
                className="mt-1.5 w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 placeholder:text-pavo-gray-600/60 focus:border-pavo-teal focus:outline-none disabled:opacity-60"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
                Wachtwoord
              </span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={status === "submitting"}
                autoComplete="current-password"
                className="mt-1.5 w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 focus:border-pavo-teal focus:outline-none disabled:opacity-60"
              />
            </label>
            <button
              type="submit"
              disabled={
                status === "submitting" || !email.trim() || !password
              }
              className="w-full rounded-lg bg-pavo-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pavo-teal-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "submitting" ? "Bezig…" : "Inloggen"}
            </button>
            <button
              type="button"
              onClick={() => {
                setResetVisible(true);
                setResetEmail(email);
              }}
              className="block w-full text-center text-xs text-pavo-teal hover:underline"
            >
              Wachtwoord vergeten?
            </button>
          </form>
        )}

        {authOn && resetVisible && resetStatus !== "sent" && (
          <form
            onSubmit={handleReset}
            className="mt-5 space-y-3 border-t border-pavo-gray-100 pt-5"
          >
            <p className="text-sm font-semibold text-pavo-navy">
              Wachtwoord vergeten?
            </p>
            <p className="text-xs text-pavo-gray-600">
              Vul je e-mail in. We sturen je een 6-cijferige reset-code.
              Werkt ook voor het instellen van je eerste wachtwoord als
              je nog nooit eerder ingelogd hebt.
            </p>
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
                E-mail
              </span>
              <input
                type="email"
                required
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="naam@bedrijf.nl"
                disabled={resetStatus === "sending"}
                className="mt-1.5 w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 placeholder:text-pavo-gray-600/60 focus:border-pavo-teal focus:outline-none disabled:opacity-60"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={resetStatus === "sending" || !resetEmail.trim()}
                className="flex-1 rounded-lg bg-pavo-teal px-4 py-2 text-sm font-semibold text-white hover:bg-pavo-teal-dark disabled:opacity-60"
              >
                {resetStatus === "sending" ? "Versturen…" : "Stuur reset-code"}
              </button>
              <button
                type="button"
                onClick={() => setResetVisible(false)}
                className="rounded-lg border border-pavo-gray-100 px-4 py-2 text-sm font-medium text-pavo-gray-900 hover:border-pavo-teal hover:text-pavo-teal"
              >
                Terug
              </button>
            </div>
            {resetError && (
              <div className="rounded-lg border border-pavo-orange/30 bg-pavo-orange/5 px-4 py-3 text-sm text-pavo-gray-900">
                {resetError}
              </div>
            )}
          </form>
        )}

        {resetStatus === "sent" && (
          <div className="mt-5 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-pavo-gray-900">
            <p className="font-semibold text-emerald-800">Check je inbox.</p>
            <p>
              We hebben een reset-code naar <strong>{resetEmail}</strong>{" "}
              gestuurd. De code is 60 minuten geldig.
            </p>
            <Link
              href={`/auth/set-password?type=recovery&email=${encodeURIComponent(resetEmail)}`}
              className="inline-block rounded-lg bg-pavo-teal px-4 py-2 text-sm font-semibold text-white hover:bg-pavo-teal-dark"
            >
              Code invullen
            </Link>
          </div>
        )}

        {error && status !== "submitting" && !resetVisible && (
          <div className="mt-3 rounded-lg border border-pavo-orange/30 bg-pavo-orange/5 px-4 py-3 text-sm text-pavo-gray-900">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
