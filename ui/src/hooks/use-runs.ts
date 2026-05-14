"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listRuns,
  getRun,
  getVersion,
  listFindings,
  getFinding,
  listAttempts,
  getCoverage,
  updateFindingStatus,
  cancelRun,
  type RunSummary,
  type FindingSummary,
} from "@/lib/api";


export function useRuns(target?: string) {
  return useQuery({
    queryKey: ["runs", target ?? "all"],
    queryFn: () => listRuns(target),
    refetchInterval: 30_000,
  });
}

export function useRun(runId: string | undefined) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: () => getRun(runId!),
    enabled: !!runId,
    refetchInterval: (q) => {
      const data = q.state.data as RunSummary | undefined;
      if (!data) return 5_000;
      return data.state === "running" || data.state === "queued" ? 3_000 : 30_000;
    },
  });
}

export function useVersion() {
  return useQuery({
    queryKey: ["version"],
    queryFn: () => getVersion(),
    staleTime: 60_000,
  });
}

export function useFindings() {
  return useQuery({
    queryKey: ["findings"],
    queryFn: () => listFindings(),
    // Refresh frequently enough that newly-confirmed exploits + the
    // Documentation-Agent-in-progress badge update promptly on the
    // sidebar and findings page without manual reload.
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export function useFinding(id: string | undefined) {
  return useQuery({
    queryKey: ["finding", id],
    queryFn: () => getFinding(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useAttempts(runId: string | undefined) {
  return useQuery({
    queryKey: ["attempts", runId],
    queryFn: () => listAttempts(runId!),
    enabled: !!runId,
    refetchInterval: 5_000,
  });
}

export function useCoverage(target?: string) {
  return useQuery({
    queryKey: ["coverage", target ?? "all"],
    queryFn: () => getCoverage(target),
    refetchInterval: 30_000,
  });
}

/** Mutation hook for POST /regression-runs/{id}/cancel. Invalidates
 *  the affected run + attempts queries so the UI flips to a
 *  cancelled state immediately. */
export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => cancelRun(runId),
    onSuccess: (_, runId) => {
      qc.invalidateQueries({ queryKey: ["run", runId] });
      qc.invalidateQueries({ queryKey: ["attempts", runId] });
      qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });
}

/** Mutation hook for PATCH /findings/{id}/status. Optimistically
 *  invalidates the affected single-finding + list queries so the UI
 *  reflects the new status without a manual refresh. */
export function useUpdateFindingStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      status: FindingSummary["status"];
      commit_sha?: string;
      rationale?: string;
    }) => updateFindingStatus(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finding", id] });
      qc.invalidateQueries({ queryKey: ["findings"] });
    },
  });
}
