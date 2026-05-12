"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * Persist the currently-active /run campaign ID across navigations.
 * Without this, leaving /run unmounts the component, blowing away
 * the local useState — when the user comes back, the live verdict
 * stream resets to the empty "no active run" state even though the
 * campaign is still running on the backend.
 *
 * sessionStorage is the right scope: survives nav-away-and-back AND
 * page refresh within the same tab, clears when the tab closes (no
 * stale references across browser sessions). The launched campaign
 * keeps running on the backend regardless — losing the reference
 * just means the UI doesn't auto-resume into its stream.
 *
 * On a hard refresh the first paint lacks the value (SSR ran before
 * we could read sessionStorage); we hydrate it in an effect.
 */
const KEY = "adv-active-run-id";

export function useActiveRunId() {
  const [runId, setState] = useState<string | null>(null);

  // Hydrate from sessionStorage after mount. Safe-guarded for SSR
  // (window is undefined on the server).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(KEY);
    if (stored) setState(stored);
  }, []);

  const setRunId = useCallback((id: string | null) => {
    setState(id);
    if (typeof window === "undefined") return;
    if (id) {
      window.sessionStorage.setItem(KEY, id);
    } else {
      window.sessionStorage.removeItem(KEY);
    }
  }, []);

  return [runId, setRunId] as const;
}
