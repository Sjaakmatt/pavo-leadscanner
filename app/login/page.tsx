"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  authConfiguredOnClient,
  supabaseBrowserClient,
} from "@/lib/auth/browser";

type Status = "idle" | "sending" | "sent" | "error";
type VerifyStatus = "idle" | "verifying" | "error";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginSkeleton() {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-md flex-col justify-center px-4 py-12">
      <div className="h-48 animate-pulse rounded-lg border border-pavo-gray-100 bg-white p-6 shadow-sm" />
    </div>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const from = params.get("from") ?? "/";
  const initialError = params.get("error");
  const showCodeInitially = params.get("showCode") === "1";
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(initialError);
  // Code-fallback state: na 'magic link verstuurd' of na een mislukte
  // callback (bv. cross-browser open) tonen we een 6-cijferige code-input.
  // Supabase stuurt die token mee in dezelfde mail; werkt PKCE-loos.
  const [code, setCode] = useState("");
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(showCodeInitially);

  const authOn = authConfiguredOnClient();

  // Persist email across the magic-link round-trip zodat de code-fallback
  // ook werkt als de gebruiker via de callback terugbounce't naar /login.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (showCodeInitially) {
      const saved = window.sessionStorage.getItem("pavo:lastLoginEmail");
      if (saved) setEmail(saved);
    }
  }, [showCodeInitially]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!authOn || status === "sending") return;
    setStatus("sending");
    setError(null);

    try {
      const supabase = supabaseBrowserClient();
      const redirectTo = new URL(
        "/auth/callback",
        window.location.origin,
      );
      redirectTo.searchParams.set("from", from);
      const trimmed = email.trim();
      const { error: err } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: redirectTo.toString() },
      });
      if (err) throw err;
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("pavo:lastLoginEmail", trimmed);
      }
      setStatus("sent");
      setShowCode(true);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!authOn || verifyStatus === "verifying") return;
    setVerifyStatus("verifying");
    setVerifyError(null);

    try {
      const supabase = supabaseBrowserClient();
      const { error: err } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: "email",
      });
      if (err) throw err;
      // Hard navigate zodat de server-render de nieuwe sessie-cookies leest.
      window.location.href = from;
    } catch (err) {
      setVerifyStatus("error");
      setVerifyError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-lg border border-pavo-gray-100 bg-white p-6 shadow-sm md:p-8">
        <h1 className="text-xl font-semibold tracking-tight text-pavo-navy">
          Log in op PAVO Research Agent
        </h1>
        <p className="mt-2 text-sm text-pavo-gray-600">
          We sturen je een magic link via e-mail. Klik in je inbox om
          ingelogd te raken — geen wachtwoord nodig.
        </p>

        {!authOn && (
          <div className="mt-5 rounded-lg border border-pavo-orange/30 bg-pavo-orange/5 px-4 py-3 text-sm text-pavo-gray-900">
            Auth staat uit (geen Supabase env-config). De app draait open
            in demo-modus.
          </div>
        )}

        {authOn && status !== "sent" && (
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
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
                disabled={status === "sending"}
                className="mt-1.5 w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 placeholder:text-pavo-gray-600/60 focus:border-pavo-teal focus:outline-none disabled:opacity-60"
              />
            </label>
            <button
              type="submit"
              disabled={status === "sending" || !email.trim()}
              className="w-full rounded-lg bg-pavo-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pavo-teal-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "sending" ? "Versturen…" : "Stuur magic link"}
            </button>
          </form>
        )}

        {status === "sent" && (
          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-pavo-gray-900">
            <p className="font-semibold text-emerald-800">
              Check je inbox.
            </p>
            <p className="mt-1">
              We hebben een magic link naar <strong>{email}</strong>{" "}
              gestuurd. De link is ~10 minuten geldig en logt je in
              één klik in.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-pavo-orange/30 bg-pavo-orange/5 px-4 py-3 text-sm text-pavo-gray-900">
            {error}
          </div>
        )}

        {authOn && showCode && (
          <form
            onSubmit={handleVerifyCode}
            className="mt-5 space-y-3 border-t border-pavo-gray-100 pt-5"
          >
            <div>
              <p className="text-sm font-semibold text-pavo-navy">
                Werkt de link niet?
              </p>
              <p className="mt-1 text-xs text-pavo-gray-600">
                Werk je in Outlook of een corporate-mailbox? Link-scanners
                kunnen magic-links ongeldig maken voordat jij erop klikt.
                In dezelfde e-mail staat een 6-cijferige code — vul die
                hier in.
              </p>
            </div>
            {!email && (
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
                  className="mt-1.5 w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 placeholder:text-pavo-gray-600/60 focus:border-pavo-teal focus:outline-none"
                />
              </label>
            )}
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
                6-cijferige code
              </span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                required
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="123456"
                disabled={verifyStatus === "verifying"}
                className="mt-1.5 w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-center font-mono text-lg tracking-[0.4em] text-pavo-gray-900 focus:border-pavo-teal focus:outline-none disabled:opacity-60"
              />
            </label>
            <button
              type="submit"
              disabled={
                verifyStatus === "verifying" ||
                code.length !== 6 ||
                !email.trim()
              }
              className="w-full rounded-lg border border-pavo-teal bg-white px-4 py-2 text-sm font-semibold text-pavo-teal transition-colors hover:bg-pavo-teal/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {verifyStatus === "verifying" ? "Controleren…" : "Code bevestigen"}
            </button>
            {verifyError && (
              <p className="text-xs text-pavo-orange">{verifyError}</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
