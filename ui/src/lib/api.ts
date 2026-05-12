/**
 * Adversary-agent API client.
 *
 * Talks to the FastAPI service in `../service/`. Endpoints match the
 * contract documented in `../CI_INTEGRATION.md` Part 2.
 *
 * Two configuration knobs:
 *   - NEXT_PUBLIC_ADVERSARY_API_BASE — full base URL (default: dev URL)
 *   - NEXT_PUBLIC_ADVERSARY_API_TOKEN — bearer token; in real deployments
 *     this is server-side only and the dashboard goes through a proxy.
 *     For the standalone-dashboard demo we read it from a public env var.
 */

const API_BASE =
  process.env.NEXT_PUBLIC_ADVERSARY_API_BASE ??
  "https://adversary-agent-dev.up.railway.app";

const API_TOKEN = process.env.NEXT_PUBLIC_ADVERSARY_API_TOKEN ?? "";


export interface RunSummary {
  run_id: string;
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  started_at: string;
  ended_at: string | null;
  duration_s: number | null;
  spend_usd: number;
  target_url: string;
  target_sha: string | null;
  baseline_sha: string | null;
  totals: { pass: number; fail: number; partial: number; inconclusive: number };
  deltas?: {
    new_passes_high_sev: number;
    new_passes_total: number;
    pass_rate_change_pct: number;
    cost_per_cycle_change_pct: number;
  };
  gate?: { verdict: "pass" | "fail" | "error"; reasons: string[] } | null;
}

export interface ListRunsResponse {
  runs: RunSummary[];
  count: number;
}


export class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`API ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}


async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (API_TOKEN) headers.set("Authorization", `Bearer ${API_TOKEN}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const resp = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!resp.ok) {
    throw new ApiError(resp.status, await resp.text());
  }
  return resp.json() as Promise<T>;
}


// ─── Endpoints ────────────────────────────────────────────────────

export function listRuns(target?: string): Promise<ListRunsResponse> {
  const q = target ? `?target=${encodeURIComponent(target)}` : "";
  return request<ListRunsResponse>(`/regression-runs${q}`);
}

export function getRun(runId: string): Promise<RunSummary> {
  return request<RunSummary>(`/regression-runs/${encodeURIComponent(runId)}`);
}

export interface SubmitRunRequest {
  target_url: string;
  suite_ref: string;
  source?: "manual" | "circleci" | "scheduled";
  commit_sha?: string;
  baseline_target_sha?: string;
  max_seconds?: number;
  budget_usd?: number;
}

export interface SubmitRunResponse {
  run_id: string;
  state: string;
  estimated_seconds: number;
  links: { self: string; dashboard: string };
}

export function submitRun(body: SubmitRunRequest): Promise<SubmitRunResponse> {
  return request<SubmitRunResponse>(`/regression-runs`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function cancelRun(runId: string): Promise<{ run_id: string; state: string }> {
  return request(`/regression-runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
  });
}

export interface VersionInfo {
  service: string;
  version: string;
  git_commit_sha: string;
  build_rev: string;
}

export function getVersion(): Promise<VersionInfo> {
  return request<VersionInfo>(`/version`);
}

export function getHealth(): Promise<{ status: string }> {
  return request(`/health`);
}
