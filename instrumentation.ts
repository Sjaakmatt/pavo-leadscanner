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
    runtime: "nodejs",
  });
  // Loopt via logObs zodat het deploy-event onder category=system valt
  // en op het dashboard in de juiste tab terechtkomt.
  const { logObs } = await import("@/lib/observability/logger");
  void logObs({
    type: "deploy",
    category: "system",
    message: "PAVO leadscanner gestart",
    metadata: { mode: process.env.MODE ?? "demo" },
  });
}

// Server-side error capture in App Router. Stuurt elke gevangen
// request-error door naar het FactumAI-dashboard zodat alle observability
// op één plek terechtkomt. Loopt via logError voor PII-redaction +
// secret-stripping en wordt onder category=system gegroepeerd — met de
// juiste route in metadata zodat de dashboard-tab "Errors" stack-traces
// per route kan groeperen.
export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string },
  context: { routerKind?: string; routePath?: string },
) {
  const { factum } = await import("@/lib/factum/client");
  if (!factum.enabled) return;
  const { logError } = await import("@/lib/observability/logger");
  void logError("system", "Next.js request error", err, {
    metadata: {
      path: request.path,
      method: request.method,
      routerKind: context.routerKind,
      routePath: context.routePath,
    },
  });
}
