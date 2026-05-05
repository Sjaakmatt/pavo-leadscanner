import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
  },
};

// Wrap met Sentry alleen wanneer DSN is gezet — anders blijft de
// build licht en heeft de demo geen sentry-overhead.
const finalConfig = process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      silent: true,
      sourcemaps: { disable: true },
      disableLogger: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
    })
  : nextConfig;

export default finalConfig;
