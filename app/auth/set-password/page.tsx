"use client";

// Wachtwoord-set pagina. Gebruikt voor twee flows:
//
//   ?type=invite     — nieuwe user uitgenodigd door admin; verifyOtp
//                      met type='invite', daarna setUser({password})
//   ?type=recovery   — bestaande user heeft "wachtwoord vergeten";
//                      verifyOtp met type='recovery', daarna setUser
//
// Beide gebruiken een 6-cijferige OTP-code uit de email + nieuw
// wachtwoord. Geen klikbare token-URL nodig (Defender-bypass).
//
// Email-veld komt uit query-string (pre-filled vanuit email-link)
// of de user vult 'm zelf in.

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowserClient } from "@/lib/auth/browser";

type FlowType = "invite" | "recovery";
type Status = "idle" | "submitting" | "error";

const PASSWORD_MIN = 8;

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <SetPasswordForm />
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

function SetPasswordForm() {
  const params = useSearchParams();
  const initialEmail = params.get("email") ?? "";
  const flowType: FlowType = params.get("type") === "recovery" ? "recovery" : "invite";

  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < PASSWORD_MIN) {
      setError(`Wachtwoord moet minstens ${PASSWORD_MIN} tekens hebben.`);
      return;
    }
    if (password !== confirm) {
      setError("Wachtwoorden komen niet overeen.");
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Vul de 6-cijferige code uit je e-mail in.");
      return;
    }

    setStatus("submitting");
    try {
      const supabase = supabaseBrowserClient();

      // Stap 1: verifieer OTP — dat zet een sessie (ingelogd-state)
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: flowType,
      });
      if (verifyErr) throw verifyErr;

      // Stap 2: zet het wachtwoord op de net-aangemaakte sessie
      const { error: updateErr } = await supabase.auth.updateUser({
        password,
      });
      if (updateErr) throw updateErr;

      // Hard navigate zodat server-render de nieuwe sessie ziet
      window.location.href = "/";
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const heading =
    flowType === "invite" ? "Wachtwoord instellen" : "Nieuw wachtwoord kiezen";
  const intro =
    flowType === "invite"
      ? "Welkom bij PAVO HR! Vul de code uit je uitnodigingsmail in en kies een wachtwoord."
      : "Vul de reset-code uit je e-mail in en kies een nieuw wachtwoord.";

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-lg border border-pavo-gray-100 bg-white p-6 shadow-sm md:p-8">
        <h1 className="text-xl font-semibold tracking-tight text-pavo-navy">
          {heading}
        </h1>
        <p className="mt-2 text-sm text-pavo-gray-600">{intro}</p>

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
              disabled={status === "submitting"}
              className="mt-1.5 w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 placeholder:text-pavo-gray-600/60 focus:border-pavo-teal focus:outline-none disabled:opacity-60"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
              6-cijferige code
            </span>
            <input
              type="text"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              disabled={status === "submitting"}
              className="mt-1.5 w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-center text-lg font-mono tracking-[0.4em] text-pavo-gray-900 placeholder:text-pavo-gray-600/60 focus:border-pavo-teal focus:outline-none disabled:opacity-60"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
              Nieuw wachtwoord (min. {PASSWORD_MIN} tekens)
            </span>
            <input
              type="password"
              required
              minLength={PASSWORD_MIN}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              disabled={status === "submitting"}
              className="mt-1.5 w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 focus:border-pavo-teal focus:outline-none disabled:opacity-60"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-medium uppercase tracking-wide text-pavo-gray-600">
              Herhaal wachtwoord
            </span>
            <input
              type="password"
              required
              minLength={PASSWORD_MIN}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={status === "submitting"}
              className="mt-1.5 w-full rounded-lg border border-pavo-gray-100 bg-white px-3 py-2 text-sm text-pavo-gray-900 focus:border-pavo-teal focus:outline-none disabled:opacity-60"
            />
          </label>

          <button
            type="submit"
            disabled={status === "submitting"}
            className="w-full rounded-lg bg-pavo-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pavo-teal-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "submitting"
              ? "Bezig…"
              : flowType === "invite"
                ? "Account activeren"
                : "Wachtwoord instellen"}
          </button>
        </form>

        {error && (
          <div className="mt-3 rounded-lg border border-pavo-orange/30 bg-pavo-orange/5 px-4 py-3 text-sm text-pavo-gray-900">
            {error}
          </div>
        )}

        <p className="mt-5 text-xs text-pavo-gray-600">
          Geen e-mail ontvangen? Kijk in je spam-folder. De code is 60
          minuten geldig.
        </p>
      </div>
    </div>
  );
}
