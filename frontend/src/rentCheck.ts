/**
 * AI check of a rent split's inputs (backend: POST /api/rent-check, app/rentcheck.py).
 * The model only reviews inputs; numbers always come from rentSplit.ts.
 * Lookup order: bundled demo results (public/demo/rentcheck) -> backend cache -> a live check,
 * which only runs when the user asks for it.
 */
import { API, DEMO, fetchJson } from "./api";
import type { SplitOptions, SplitResult } from "./rentSplit";

export interface RentCheckRow {
  room_id: string;
  name: string;
  bedroom_area: number;
  private_bath: boolean;
  private_bath_area: number;
  share: number;
  vs_even: number;
}

export interface RentCheckRequest {
  plan: string;
  method: SplitOptions["method"];
  include_closets: boolean;
  rent: number;
  rows: RentCheckRow[];
  private_portion: number;
  shared_portion: number;
  shared_each: number;
}

export interface RentCheckResult {
  key: string;
  plan: string;
  verdict: "ok" | "warn";
  checks: { id: "bedroom_count" | "private_bath" | "areas" | "extras"; status: "pass" | "warn"; reason: string }[];
  suggestions: { action: "set_private_bath" | "include_closets"; room_id: string | null; value: boolean; reason: string; label: string }[];
  explanation: string;
  explanation_source: "ai" | "template";
  provider: string;
  model: string;
  checked_at: string;
  cached?: boolean;
}

export function rentCheckRequest(plan: string, split: SplitResult, opts: Pick<SplitOptions, "method" | "includeClosets">): RentCheckRequest {
  return {
    plan,
    method: opts.method,
    include_closets: opts.includeClosets,
    rent: Math.round(split.rent),
    rows: split.rows.map((r) => ({
      room_id: r.room.id,
      name: r.room.name,
      bedroom_area: r.bedroomArea,
      private_bath: r.hasPrivateBath,
      private_bath_area: r.privateBathArea,
      share: r.share,
      vs_even: r.vsEven,
    })),
    private_portion: split.privatePortion,
    shared_portion: split.sharedPortion,
    shared_each: split.sharedEach,
  };
}

/** Must match key_string() in backend/app/rentcheck.py. */
export function rentCheckKeyString(req: RentCheckRequest): string {
  const rows = [...req.rows].sort((a, b) => (a.room_id < b.room_id ? -1 : a.room_id > b.room_id ? 1 : 0));
  const r10 = (x: number) => Math.round(x * 10);
  const body = rows.map((r) => `${r.room_id}:${r10(r.bedroom_area)}:${r.private_bath ? 1 : 0}:${r10(r.private_bath_area)}:${r.share}`).join(";");
  return `rc1|${req.plan}|${req.method}|${req.include_closets ? 1 : 0}|${req.rent}|${body}`;
}

function fnv1a(bytes: Uint8Array, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 16 hex chars, same as input_key() in the backend (plain FNV-1a: works without crypto.subtle). */
export function rentCheckKey(req: RentCheckRequest): string {
  const bytes = new TextEncoder().encode(rentCheckKeyString(req));
  return [fnv1a(bytes, 0), fnv1a(bytes, 0x9e3779b9)].map((h) => h.toString(16).padStart(8, "0")).join("");
}

let demoIndex: Promise<Record<string, string>> | null = null;

/** A check already on disk: bundled with the demo, else in the backend cache. Never calls a model. */
export async function cachedRentCheck(req: RentCheckRequest): Promise<RentCheckResult | null> {
  const key = rentCheckKey(req);
  demoIndex ??= fetchJson<{ checks: Record<string, string> }>(`${DEMO}/rentcheck/index.json`)
    .then((d) => d.checks)
    .catch(() => ({}));
  const file = (await demoIndex)[key];
  if (file) {
    try {
      return { ...(await fetchJson<RentCheckResult>(`${DEMO}/rentcheck/${file}`)), cached: true };
    } catch {
      /* fall through to the backend */
    }
  }
  try {
    return await fetchJson<RentCheckResult>(`${API}/api/rent-check?cache_only=1`, jsonPost(req), 4000);
  } catch {
    return null;
  }
}

/** Ask the backend to run the vision check now (one model call, then cached). */
export function liveRentCheck(req: RentCheckRequest): Promise<RentCheckResult> {
  return fetchJson<RentCheckResult>(`${API}/api/rent-check`, jsonPost(req), 120_000);
}

function jsonPost(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
