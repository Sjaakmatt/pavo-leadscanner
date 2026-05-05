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
  await factum.logEvent("deploy", "PAVO leadscanner gestart", {
    mode: process.env.MODE ?? "demo",
  });
}

// Server-side error capture in App Router. Stuurt elke gevangen
// request-error door naar het FactumAI-dashboard zodat alle observability
// op één plek terechtkomt.
export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string },
  context: { routerKind?: string; routePath?: string },
) {
  const { factum } = await import("@/lib/factum/client");
  if (!factum.enabled) return;
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  void factum.logEvent("error", `Next.js: ${message}`, {
    path: request.path,
    method: request.method,
    routerKind: context.routerKind,
    routePath: context.routePath,
    stack: stack?.slice(0, 4_000),
  });
}
