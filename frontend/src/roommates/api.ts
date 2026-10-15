/**
 * Roommate finder client (backend: /api/roommates, app/roommates/). Everything has an offline
 * path: profiles, the questionnaire and the pre-generated demo negotiations are bundled in
 * public/demo/roommates/, and a stored negotiation replays its recorded events.
 */
import { API, DEMO, fetchJson } from "../api";
import type { FurnitureItem } from "../components/FloorPlan3D/furniture";

export type Questionnaire = Record<string, Record<string, unknown>>;
export type Furniture = string | { name: string; w: number; d: number; h: number };

export interface Profile {
  id: string;
  name: string;
  school: string;
  program: string;
  hometown: string;
  color: string;
  bio: string;
  furniture: Furniture[];
  questionnaire: Questionnaire;
  sample?: boolean;
  /** already rents this unit with an open room ("Fill a room"), so not in the Discover deck */
  hosting?: string;
}

export interface QuestionSpec {
  question: string;
  type: "select" | "multiselect" | "number" | "slider" | "text";
  options?: string[] | string;
  required?: boolean;
  min?: number;
  max?: number;
  default?: number;
  max_select?: number;
  placeholder?: string;
  help?: string;
  labels?: string[];
}

export interface QuestionnaireSchema {
  sections: Record<string, string>;
  questions: Record<string, Record<string, QuestionSpec>>;
}

export type Verdict = "strong" | "conditional" | "incompatible";

export interface NegotiationMessage {
  speaker: string;
  speaker_id: "a" | "b";
  message: string;
  turn: number;
  phase: "introduction" | "exploration" | "negotiation" | "conclusion";
  timestamp: string;
  /** one plain-English line saying what the message means (written once per message, cached) */
  say?: string;
}

export interface Check {
  id: "budget" | "gender" | "furniture" | "bathroom" | "lease" | "move_in";
  ok: boolean;
  hard: boolean;
  detail: string;
}

export interface Outcome {
  status: Verdict;
  reason: string | null;
  unresolved_topics: string[];
  source: "vrd" | "keywords" | "analysis" | "exact_check";
}

export interface Analysis {
  scores: { overall: number; finances: number; lifestyle: number; personality: number; logistics: number };
  highlights: string[];
  concerns: string[];
  dealbreaker_detected: boolean;
  dealbreaker_detail: string;
  middle_ground: string[];
  recommendation: Verdict;
  recommendation_summary: string;
}

export type NegotiationEvent =
  | { type: "checks"; checks: Check[] }
  | { type: "phase_start"; phase: NegotiationMessage["phase"]; label: string }
  | { type: "agent_message"; data: NegotiationMessage }
  | { type: "analyzing" }
  | { type: "complete"; result: Outcome; analysis: Analysis | null; checks: Check[] }
  | { type: "error"; message: string };

export interface RoomContext {
  plan: string;
  unit_name: string;
  rent_total: number;
  beds: number;
  room_id: string;
  room_label: string;
  area_sqft: number;
  share: number;
  private_bath: boolean;
  furniture?: { items: string[]; all_fit: boolean; free_sqft: number | null; note: string } | null;
  members: { profile_id: string; name: string; room_label: string; share: number }[];
}

export interface NegotiationRecord {
  id: string;
  mode: "find" | "fill";
  a: { id: string; name: string };
  b: { id: string; name: string };
  room: RoomContext | null;
  status: "running" | "complete" | "error";
  checks: Check[];
  result: Outcome | null;
  analysis: Analysis | null;
  messages: NegotiationMessage[];
  events?: (NegotiationEvent & { seq: number })[];
  providers?: Record<string, number>;
  error?: string;
}

export interface GroupVerdict {
  match: boolean;
  status: "strong" | "conditional" | "no_match";
  rule: "all" | "majority";
  approvals: number;
  members: number;
  summary: string;
}

export interface Scenarios {
  find: {
    pairs: { a: string; b: string; id: string; status: Verdict | null }[];
    groups: { members: string[]; score: number; pairs: { id: string; a: string; b: string; status: Verdict }[]; budget_min: number; budget_max: number; beds: number }[];
  };
  fill: {
    id: string;
    candidate: string;
    members: { id: string; room_id: string }[];
    room: RoomContext;
    negotiations: { member: { id: string; name: string }; id: string; status: string; verdict: Verdict | null }[];
    group: GroupVerdict | null;
    layout?: FurnitureItem[]; // the candidate's furniture as placed in the open room by the fit check
  }[];
}

const RM = `${DEMO}/roommates`;

/** Backend first (it may have profiles people created), else the bundled sample profiles. */
export async function loadProfiles(): Promise<{ profiles: Profile[]; offline: boolean }> {
  try {
    return { profiles: await fetchJson<Profile[]>(`${API}/api/roommates/profiles`, {}, 3000), offline: false };
  } catch {
    return { profiles: await fetchJson<Profile[]>(`${RM}/profiles.json`), offline: true };
  }
}

export function loadQuestionnaire(): Promise<QuestionnaireSchema> {
  return fetchJson<QuestionnaireSchema>(`${RM}/questionnaire.json`);
}

let scenarios: Promise<Scenarios> | null = null;
export function loadScenarios(): Promise<Scenarios> {
  scenarios ??= fetchJson<Scenarios>(`${RM}/scenarios.json`);
  return scenarios;
}

/** A finished negotiation: the bundled copy if there is one, else the backend's. */
export async function loadNegotiation(id: string): Promise<NegotiationRecord> {
  try {
    return await fetchJson<NegotiationRecord>(`${RM}/negotiations/${encodeURIComponent(id)}.json`);
  } catch {
    return fetchJson<NegotiationRecord>(`${API}/api/roommates/negotiations/${encodeURIComponent(id)}`);
  }
}

/** Ask the backend to negotiate (returns at once; stored pairs come back complete). */
export function startNegotiation(a: string, b: string, room?: RoomContext): Promise<NegotiationRecord> {
  return fetchJson<NegotiationRecord>(`${API}/api/roommates/negotiations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ a, b, room }),
  }, 8000);
}

/**
 * Follow a negotiation: replays a stored record's events, or streams a live one over SSE.
 * Returns a function that stops listening.
 */
export function followNegotiation(id: string, onEvent: (e: NegotiationEvent) => void, onError: (msg: string) => void): () => void {
  let stopped = false;
  let source: EventSource | null = null;
  loadNegotiation(id)
    .then((rec) => {
      if (stopped) return;
      if (rec.status === "complete" && rec.events?.length) {
        rec.events.forEach(onEvent);
        return;
      }
      source = new EventSource(`${API}/api/roommates/negotiations/${encodeURIComponent(id)}/stream`);
      const types = ["checks", "phase_start", "agent_message", "analyzing", "complete", "error"];
      for (const t of types) {
        source.addEventListener(t, (ev) => {
          const data = JSON.parse((ev as MessageEvent).data) as NegotiationEvent;
          onEvent(data);
          if (t === "complete" || t === "error") source?.close();
        });
      }
      source.onerror = () => {
        if (source?.readyState === EventSource.CLOSED) return;
        source?.close();
        onError("Lost the connection to the live negotiation.");
      };
    })
    .catch(() => !stopped && onError("This conversation isn't available right now."));
  return () => {
    stopped = true;
    source?.close();
  };
}

/** Same rule as group_verdict() in backend/app/roommates/checks.py (the rule is a setting in the UI). */
export function groupVerdict(results: { member: string; status: Verdict }[], rule: "all" | "majority"): GroupVerdict {
  const ok = results.filter((r) => r.status !== "incompatible");
  const match = rule === "all" ? results.length > 0 && ok.length === results.length : ok.length * 2 > results.length;
  const no = results.filter((r) => r.status === "incompatible").map((r) => r.member);
  return {
    match,
    status: !match ? "no_match" : results.every((r) => r.status === "strong") ? "strong" : "conditional",
    rule,
    approvals: ok.length,
    members: results.length,
    summary: (ok.length === results.length ? "Everyone agreed" : `${ok.length} of ${results.length} roommates agreed`) + (match ? "" : `; not a match (${no.join(", ")} said no)`),
  };
}

export interface HouseRules {
  key: string;
  members: string[];
  negotiations: string[];
  rules: { topic: "quiet hours" | "guests" | "chores" | "kitchen" | "costs" | "other"; text: string }[];
  open: string[];
}

/** The house rules a group's clones agreed on: bundled for the demo group, else made once by the backend. */
export async function loadHouseRules(members: string[], negotiations: string[]): Promise<HouseRules> {
  const key = [...members].sort().join("+");
  try {
    return await fetchJson<HouseRules>(`${RM}/house_rules/${key}.json`); // ids are [a-z]+, so the key needs no escaping
  } catch {
    return fetchJson<HouseRules>(`${API}/api/roommates/house-rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ members, negotiations }),
    }, 60000);
  }
}
