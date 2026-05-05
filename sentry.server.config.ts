// Sentry server-side init — laadt op elke Node-runtime request.
// DSN komt uit env; ontbreken = silently skip (geen crash).

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;
const mode = (process.env.MODE ?? "demo").toLowerCase();

if (dsn) {
  Sentry.init({
    dsn,
    environment: mode,
    tracesSampleRate: mode === "demo" ? 0 : 0.1,
    // Demo-events filteren: klant-demos genereren noise die niet
    // representatief is voor prod-issues.
    beforeSend(event) {
      if (mode === "demo") return null;
      return event;
    },
  });
}
