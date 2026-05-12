/**
 * Shared UI-facing types. Mirrors the FastAPI service's response shapes
 * for `/findings`, `/regression-runs`, and `/coverage`. Kept in a
 * separate file so components can import them without pulling in the
 * full @/lib/api client.
 */

export type Severity = "critical" | "high" | "medium" | "low";
export type Verdict = "pass" | "fail" | "partial" | "inconclusive";
export type Status = "open" | "in_progress" | "resolved" | "draft";
