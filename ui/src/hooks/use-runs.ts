"use client";

import { useQuery } from "@tanstack/react-query";
import { listRuns, getRun, getVersion, type RunSummary } from "@/lib/api";


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
      // Poll faster while running, slower once terminal.
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
