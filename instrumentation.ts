// Next.js instrumentation hook — wordt automatisch geladen door Next.js
// bij iedere server-start (zowel `next dev` als productie). Wij gebruiken
// hem om de FactumAI-client te registreren, de heartbeat te starten en
// netjes af te melden bij shutdown.
//
// Skip-pad: als FACTUM_DASHBOARD_URL/FACTUM_API_KEY ontbreken doet de
// client zelf niets, dus de agent blijft volledig stand-alone.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { factum } = await import("@/lib/factum/client");
  if (!factum.enabled) return;

  await factum.connect({
    version: process.env.npm_package_version ?? "0.2.0",
    hostname: process.env.HOSTNAME ?? process.env.VERCEL_URL,
    runtime: `node-${process.versions.node}`,
  });
  await factum.logEvent("deploy", "PAVO leadscanner gestart", {
    mode: process.env.MODE ?? "demo",
  });

  const shutdown = (reason: string) => {
    void factum.disconnect(reason);
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
