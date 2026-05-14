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
  /** Cross-platform jump links. `langfuse` points at the trace tree
   *  for this run when Langfuse was configured; absent otherwise. */
  links?: { dashboard?: string; findings?: string; langfuse?: string };
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
  /** Optional seed-directory names. When set, overrides the suite_ref's
   *  default category list — used by the Ad Hoc Run page so the user's
   *  checkbox selection actually drives what runs. */
  categories?: string[];
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


// ─── Findings ─────────────────────────────────────────────────────

export interface FindingSummary {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "open" | "in_progress" | "resolved" | "draft";
  category: string;
  subcategory: string;
  discovered: string;
  attack_id?: string;
  repro_summary?: string;
  /** Documentation Agent lifecycle for AUTO-* findings. Hand-authored
   *  VULN-NNNN findings don't set this (always undefined). */
  doc_agent_status?: "absent" | "in_progress" | "completed" | "failed";
}

export interface FindingDetail extends FindingSummary {
  body_markdown: string;
  target?: string;
  campaign_id?: string;
  threat_model_ref?: string;
  status_history?: {
    changed_at: string;
    changed_by?: string;
    commit_sha?: string;
    rationale?: string;
  };
}

export function listFindings(): Promise<{ findings: FindingSummary[]; count: number }> {
  return request("/findings");
}

export function getFinding(id: string): Promise<FindingDetail> {
  return request(`/findings/${encodeURIComponent(id)}`);
}

export function updateFindingStatus(
  id: string,
  body: { status: FindingSummary["status"]; commit_sha?: string; rationale?: string },
): Promise<FindingDetail> {
  return request(`/findings/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}


// ─── Compliance report ────────────────────────────────────────────

/** Downloads the multi-section CSV report from /report.csv and
 *  triggers a browser file save. Returns the filename used. */
export async function downloadComplianceReport(): Promise<string> {
  const headers = new Headers();
  if (API_TOKEN) headers.set("Authorization", `Bearer ${API_TOKEN}`);
  const resp = await fetch(`${API_BASE}/report.csv`, { headers });
  if (!resp.ok) {
    throw new ApiError(resp.status, await resp.text());
  }
  // Try to honor the server-set Content-Disposition filename; fall
  // back to a sensible default if the header isn't readable (some
  // CORS configs hide it from JS).
  const cd = resp.headers.get("Content-Disposition") || "";
  const match = cd.match(/filename="?([^";]+)"?/i);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = match?.[1] || `adversary-compliance-report-${ts}.csv`;
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}


// ─── Attempts (per-attack rows within a run) ────────────────────

export interface Attempt {
  attempt_id: string;
  run_id: string;
  seed_id: string;
  category: string;
  subcategory: string;
  verdict: "pass" | "fail" | "partial" | "inconclusive";
  response_text: string;
  latency_ms: number;
  spend_usd: number;
  started_at: string;
  primary_verdict?: "pass" | "fail" | "partial" | "inconclusive" | null;
  primary_model?: string | null;
  secondary_verdict?: "pass" | "fail" | "partial" | "inconclusive" | null;
  secondary_model?: string | null;
  arbitrator_verdict?: "pass" | "fail" | "partial" | "inconclusive" | null;
  arbitrator_model?: string | null;
  judges_agreed?: 0 | 1 | null;
  confidence?: "high" | "medium" | "low" | null;
  reason_code?: string | null;
  /** True when this attempt is verdict=pass on an attack_id whose
   * owning VULN-NNNN was previously marked resolved. */
  is_regression?: boolean;
}

export function listAttempts(runId: string): Promise<{ run_id: string; attempts: Attempt[]; count: number }> {
  return request(`/regression-runs/${encodeURIComponent(runId)}/attempts`);
}

/** Reproducible eval artifact: run metadata + every attempt with full
 * judge breakdown. Designed to be saved to disk by the UI. */
export function fetchRunArtifact(runId: string): Promise<unknown> {
  return request(`/regression-runs/${encodeURIComponent(runId)}/artifact`);
}

export interface TargetPing {
  target_url: string;
  ok: boolean;
  status_code: number | null;
  latency_ms: number | null;
  checked_at: string;
  error?: string;
}

/** Live probe of the target Co-Pilot's /health endpoint. The dashboard
 * pings this to display a visible proof of live connectivity. */
export function pingTarget(url?: string): Promise<TargetPing> {
  const q = url ? `?url=${encodeURIComponent(url)}` : "";
  return request(`/target/ping${q}`);
}


// ─── Judge ground-truth accuracy ────────────────────────────────

export interface JudgeAccuracy {
  ran_at: string;
  judge_models: {
    primary: string | null;
    secondary: string | null;
    arbitrator: string | null;
  };
  summary: {
    total: number;
    correct: number;
    accuracy: number | null;
    by_verdict: Record<string, { total: number; correct: number }>;
    disagreements: number;
    arbitrator_used: number;
    total_usd: number;
    duration_s: number;
  };
  cases: Array<{
    id: string;
    expected: string;
    actual: string;
    correct: boolean;
    primary?: string;
    primary_model?: string;
    secondary?: string;
    secondary_model?: string;
    arbitrator?: string | null;
    arbitrator_model?: string | null;
    agreed?: boolean;
    confidence?: string;
    reason_code?: string;
    rationale?: string;
    error?: string;
  }>;
}

export async function fetchJudgeAccuracy(): Promise<JudgeAccuracy | null> {
  try {
    return await request<JudgeAccuracy>(`/judge-accuracy`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return null;
    }
    throw e;
  }
}


// ─── Coverage (subcategory-level aggregates) ──────────────────

export interface CoverageRow {
  category: string;
  subcategory: string;
  cases: number;
  exploits: number;
  held: number;
  partial: number;
  last_run_at: string | null;
}

export function getCoverage(): Promise<{ rows: CoverageRow[] }> {
  return request(`/coverage`);
}
