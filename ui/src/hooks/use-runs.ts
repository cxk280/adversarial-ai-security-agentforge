"use client";

import { useQuery } from "@tanstack/react-query";
import {
  listRuns,
  getRun,
  getVersion,
  listFindings,
  getFinding,
  type RunSummary,
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
    staleTime: 30_000,
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
