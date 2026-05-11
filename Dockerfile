# Dockerfile for the adversary-agent FastAPI service.
#
# Build:    docker build -t adversary-agent .
# Run:      docker run -p 8000:8000 \
#                      -e ADVERSARY_API_TOKEN=<token> \
#                      -e ANTHROPIC_API_KEY=<key> \
#                      -e OPENAI_API_KEY=<key> \
#                      -e DEEPSEEK_API_KEY=<key> \
#                      -e RUNPOD_API_KEY=<key> \
#                      -e RUNPOD_ENDPOINT=<url> \
#                      adversary-agent
#
# On Railway: pushed via `railway up --service adversary-agent`.
# Railway sets RAILWAY_GIT_COMMIT_SHA automatically; the /version
# endpoint reports it back so CircleCI's wait-for-adversary-sha command
# (see CI_INTEGRATION.md) can poll until the right SHA is live.

FROM python:3.13-slim AS base

# Avoid Python writing .pyc files; flush stdout immediately so Railway's
# log viewer shows boot output without buffering.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install OS deps (none beyond what python:3.13-slim has — kept here as
# the explicit anchor for when we need to add something).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first (cached layer) so app-code changes don't
# trigger a full reinstall.
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy application code. .dockerignore filters out node_modules,
# .next, .git, design/, tests/, etc. — anything that doesn't belong in
# the runtime image.
COPY agents/  ./agents/
COPY harness/ ./harness/
COPY service/ ./service/
COPY evals/   ./evals/

# Make sure the SQLite DB lives in a writable path. On Railway the
# working directory is writable and we don't (yet) attach a volume —
# DB resets on redeploy, which is fine for MVP (no findings yet).
ENV ADVERSARY_DB_PATH=/app/adversary.sqlite

EXPOSE 8000

# uvicorn with --proxy-headers so Railway's edge can rewrite the
# client IP correctly. --no-access-log because Langfuse is the log of
# record once observability is wired in.
CMD ["uvicorn", "service.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--proxy-headers"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1
