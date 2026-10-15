import type { ParsedPlan, PlanSummary } from "./types";

export const API = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
export const DEMO = `${import.meta.env.BASE_URL}demo`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 4000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        const d = body?.detail;
        msg = typeof d === "string" ? d : d?.error ?? JSON.stringify(d ?? body);
      } catch {
        /* not JSON */
      }
      throw new ApiError(res.status, msg);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface PlanSource {
  plans: PlanSummary[];
  offline: boolean;
}

interface DemoEntry extends PlanSummary {
  json: string;
  image: string;
}

/** Cached plans from the backend; if it can't be reached, the bundled demo plans. */
export async function loadPlanList(): Promise<PlanSource> {
  try {
    return { plans: await fetchJson<PlanSummary[]>(`${API}/api/plans`), offline: false };
  } catch {
    const demo = await fetchJson<DemoEntry[]>(`${DEMO}/index.json`);
    return { plans: demo.map(({ json: _j, image: _i, ...p }) => p), offline: true };
  }
}

export async function loadPlan(name: string, offline: boolean): Promise<{ plan: ParsedPlan; imageUrl: string }> {
  const id = encodeURIComponent(name);
  if (offline) {
    return { plan: await fetchJson<ParsedPlan>(`${DEMO}/${id}.json`), imageUrl: `${DEMO}/${id}.png` };
  }
  return { plan: await fetchJson<ParsedPlan>(`${API}/api/plans/${id}`), imageUrl: `${API}/api/plans/${id}/image` };
}

/** Vision call takes 5-20 s (longer if a provider falls back), hence the long timeout. */
export async function parseUpload(file: File): Promise<{ plan: ParsedPlan; imageUrl: string }> {
  const body = new FormData();
  body.append("image", file);
  const plan = await fetchJson<ParsedPlan>(`${API}/api/parse`, { method: "POST", body }, 150_000);
  const name = encodeURIComponent(plan.plan_name ?? "");
  return { plan, imageUrl: `${API}/api/plans/${name}/image` };
}

export function thumbnailUrl(p: PlanSummary, offline: boolean): string | undefined {
  return offline ? `${DEMO}/${encodeURIComponent(p.name)}.png` : p.thumbnail_url && `${API}${p.thumbnail_url}`;
}
