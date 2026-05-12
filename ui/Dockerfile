# Multi-stage Dockerfile for the AgentForge adversary-ui Next.js dashboard.
#
# Build:    docker build -t adversary-ui .  (from ui/)
# Run:      docker run -p 3000:3000 \
#                      -e NEXT_PUBLIC_ADVERSARY_API_BASE=https://… \
#                      -e NEXT_PUBLIC_ADVERSARY_API_TOKEN=… \
#                      adversary-ui
#
# Railway: railway up --service adversary-ui --path-as-root . (from ui/).
# Public client-side env vars (NEXT_PUBLIC_*) are baked into the build,
# so the railway service must have them set BEFORE the build step.

# ── deps stage ─────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── builder stage ──────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env vars (NEXT_PUBLIC_* get embedded into JS bundle)
ARG NEXT_PUBLIC_ADVERSARY_API_BASE
ARG NEXT_PUBLIC_ADVERSARY_API_TOKEN
ENV NEXT_PUBLIC_ADVERSARY_API_BASE=${NEXT_PUBLIC_ADVERSARY_API_BASE}
ENV NEXT_PUBLIC_ADVERSARY_API_TOKEN=${NEXT_PUBLIC_ADVERSARY_API_TOKEN}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── runtime stage ─────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy production node_modules + built app.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next        ./.next
COPY --from=builder /app/public       ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/newrelic.js  ./newrelic.js

# New Relic APM via `-r newrelic` — bootstraps the agent before Next.js
# boots so route handlers + SSR + API routes are auto-instrumented. The
# agent reads NEW_RELIC_LICENSE_KEY + NEW_RELIC_APP_NAME from env at
# load time; when LICENSE_KEY is unset (local dev, CI), the agent warns
# and the wrapped Next.js process runs normally.
ENV NEW_RELIC_APP_NAME="adversary-ui" \
    NEW_RELIC_DISTRIBUTED_TRACING_ENABLED=true \
    NEW_RELIC_LOG_LEVEL=warning \
    NODE_OPTIONS="-r newrelic"

EXPOSE 3000
CMD npm run start -- --port ${PORT:-3000}
