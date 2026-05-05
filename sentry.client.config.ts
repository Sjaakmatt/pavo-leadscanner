// Sentry client-side init — runt in de browser.
// NEXT_PUBLIC_SENTRY_DSN moet expliciet exposed zijn (Next.js public env).

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const mode = (process.env.NEXT_PUBLIC_MODE ?? "demo").toLowerCase();

if (dsn) {
  Sentry.init({
    dsn,
    environment: mode,
    tracesSampleRate: mode === "demo" ? 0 : 0.1,
    replaysOnErrorSampleRate: mode === "demo" ? 0 : 0.5,
    replaysSessionSampleRate: 0,
    beforeSend(event) {
      if (mode === "demo") return null;
      return event;
    },
  });
}
