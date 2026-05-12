"use strict";

/**
 * New Relic Node.js agent configuration for the adversary-ui Next.js app.
 *
 * Loaded by `node -r newrelic` (set via NODE_OPTIONS in the Dockerfile CMD).
 * All sensitive values come from env vars so this file ships in the image
 * without secrets — license key etc. live on the Railway service.
 *
 * When NEW_RELIC_LICENSE_KEY is unset (local dev, CI), the agent logs a
 * warning and the wrapped Next.js process runs normally.
 */
exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || "adversary-ui"],
  license_key: process.env.NEW_RELIC_LICENSE_KEY,
  distributed_tracing: { enabled: true },
  logging: {
    level: process.env.NEW_RELIC_LOG_LEVEL || "warning",
    filepath: "stdout",
  },
  // Don't ingest health-check pings — too noisy, and Railway hammers /
  // every 30 s. Same logic as the W2 Co-Pilot config.
  rules: {
    ignore: [/^\/health$/, /^\/_next\/static\//, /^\/favicon\.ico$/],
  },
  allow_all_headers: true,
  attributes: {
    exclude: [
      "request.headers.cookie",
      "request.headers.authorization",
      "request.headers.proxyAuthorization",
      "request.headers.setCookie*",
      "request.headers.x*",
      "response.headers.cookie",
      "response.headers.authorization",
      "response.headers.setCookie*",
    ],
  },
};
