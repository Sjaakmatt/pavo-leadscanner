"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  authConfiguredOnClient,
  supabaseBrowserClient,
} from "@/lib/auth/browser";

type Status = "idle" | "sending" | "sent" | "error";

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
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const authOn = authConfiguredOnClient();

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
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo.toString() },
      });
      if (err) throw err;
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
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
          <p className="mt-3 text-xs text-pavo-orange">{error}</p>
        )}
      </div>
    </div>
  );
}
