"""FastAPI entrypoint for the adversary-agent service.

Run locally:
    ADVERSARY_DISABLE_AUTH=1 uvicorn service.main:app --reload --port 9000

Endpoints (per CI_INTEGRATION.md):
    POST   /regression-runs              submit a run
    GET    /regression-runs/{id}         poll
    GET    /regression-runs              list
    POST   /regression-runs/{id}/cancel  cancel
    POST   /audit/bypass                 record adversarial-bypass commit
    GET    /health                       liveness
    GET    /version                      build markers (used by CI's wait-for-sha)
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from service import db
from service.api import audit, findings, report, runs


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    yield


app = FastAPI(
    title="AgentForge Adversary Agent",
    version="0.1.0",
    description=(
        "Adversarial AI Security Platform service. Authorized targets and "
        "scope: see ARCHITECTURE.md §13."
    ),
    lifespan=lifespan,
)

# CORS — the adversary-ui dashboard runs on a different origin than the
# adversary-agent service. We allow the deployed UI URLs + localhost dev.
# Tightening to a regex makes accidental adversary-agent-XYZ targets fail
# loudly rather than silently expanding the trusted set.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=(
        r"^https://adversary-ui(-dev|-qa|-production)?\.up\.railway\.app$"
        r"|^http://localhost:\d+$"
    ),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["X-Request-Id"],
    max_age=86400,
)


# Routers
app.include_router(runs.router)
app.include_router(audit.router)
app.include_router(findings.router)
app.include_router(report.router)


# ─── Public health + version (no auth) ─────────────────────────────

@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/version")
async def version() -> dict:
    return {
        "service": "adversary-agent",
        "version": "0.1.0",
        "git_commit_sha": os.environ.get("RAILWAY_GIT_COMMIT_SHA", "unknown"),
        "build_rev": os.environ.get("BUILD_REV", "unknown"),
    }
