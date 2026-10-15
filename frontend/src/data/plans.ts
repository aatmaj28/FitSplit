import { useEffect, useState } from "react";
import { loadPlan, loadPlanList } from "../api";
import type { ParsedPlan } from "../types";

let source: Promise<{ offline: boolean }> | null = null;
const cache = new Map<string, Promise<{ plan: ParsedPlan; imageUrl: string }>>();

/** Is the backend up? Decided once per page load (falls back to the bundled demo plans). */
export function planSource(): Promise<{ offline: boolean }> {
  source ??= loadPlanList().then((s) => ({ offline: s.offline })).catch(() => ({ offline: true }));
  return source;
}

export function getPlan(id: string): Promise<{ plan: ParsedPlan; imageUrl: string }> {
  if (!cache.has(id)) {
    cache.set(id, planSource().then(({ offline }) => loadPlan(id, offline).catch(() => loadPlan(id, true))));
  }
  return cache.get(id)!;
}

export function usePlan(id: string | undefined) {
  const [state, setState] = useState<{ plan: ParsedPlan; imageUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setState(null);
    setError(null);
    getPlan(id).then((r) => alive && setState(r), (e) => alive && setError(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [id]);
  return { data: state, error };
}

export function useOffline(): boolean | null {
  const [offline, setOffline] = useState<boolean | null>(null);
  useEffect(() => {
    planSource().then((s) => setOffline(s.offline));
  }, []);
  return offline;
}
