// Sentry edge-runtime init — middleware + edge-routes.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;
const mode = (process.env.MODE ?? "demo").toLowerCase();

if (dsn) {
  Sentry.init({
    dsn,
    environment: mode,
    tracesSampleRate: mode === "demo" ? 0 : 0.1,
    beforeSend(event) {
      if (mode === "demo") return null;
      return event;
    },
  });
}
