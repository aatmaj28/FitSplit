import type { Analysis, Outcome, Profile, Scenarios } from "./api";
import { budgetOf } from "./fit";

/**
 * The Discover deck, ported from Tanvi's GET /users/candidates (AI-Roommate-Finder, server.py):
 * same city scores 3 and the same metro area 2; anyone else is hidden. "Same gender only" is
 * checked both ways, and profiles already swiped are hidden. Sorted by location score, then name.
 * Our addition: students who already host a room (they use "Fill a room") are not in the deck.
 */
const METRO_BUCKETS: Record<string, string[]> = {
  "boston-metro": ["boston", "cambridge", "somerville", "allston", "brighton", "brookline", "medford", "watertown", "newton", "quincy"],
  "sf-bay": ["san francisco", "oakland", "berkeley", "san jose", "palo alto", "mountain view"],
  "nyc-metro": ["new york", "brooklyn", "queens", "manhattan", "bronx", "staten island"],
};

export const ME = "priya"; // the signed-in demo student

export type SwipeDir = "like" | "pass";
export interface Swipe {
  id: string;
  dir: SwipeDir;
  at: string;
  /** a live negotiation started for this swipe (bundled pairs are looked up in scenarios) */
  negotiation?: string;
}
export type HiddenReason = "seen" | "hosting" | "location" | "gender";
export interface Deck {
  deck: Profile[];
  hidden: { p: Profile; reason: HiddenReason }[];
}

type Answers = Record<string, unknown>;
const section = (p: Profile, name: string) => ((p.questionnaire as Record<string, Answers | undefined>)[name] ?? {}) as Answers;
const text = (v: unknown) => String(v ?? "").trim();
const cityOf = (p: Profile) => text(section(p, "living").city ?? section(p, "living").location);

function metro(city: string): string | null {
  const c = city.toLowerCase();
  return Object.entries(METRO_BUCKETS).find(([, names]) => names.includes(c))?.[0] ?? null;
}

export function locationScore(me: Profile, other: Profile): number {
  const a = cityOf(me), b = cityOf(other);
  if (!a || !b) return 0;
  if (a.toLowerCase() === b.toLowerCase()) return 3;
  const ma = metro(a), mb = metro(b);
  return ma && mb && ma === mb ? 2 : 0;
}

/** Both people's "Same gender only" preference, cross-checked (Tanvi's _gender_match). */
export function genderMatch(me: Profile, other: Profile): boolean {
  const lm = section(me, "living"), lo = section(other, "living");
  const g = text(lm.gender), og = text(lo.gender);
  const differ = !!g && !!og && g !== og;
  if (text(lm.roommate_gender) === "Same gender only" && differ) return false;
  if (text(lo.roommate_gender) === "Same gender only" && differ) return false;
  return true;
}

export function discoverDeck(me: Profile, profiles: Profile[], swipes: Swipe[]): Deck {
  const seen = new Set(swipes.map((s) => s.id));
  const hasCity = !!cityOf(me);
  const deck: { p: Profile; score: number }[] = [];
  const hidden: Deck["hidden"] = [];
  for (const p of profiles) {
    if (p.id === me.id) continue;
    if (seen.has(p.id)) hidden.push({ p, reason: "seen" });
    else if (p.hosting) hidden.push({ p, reason: "hosting" });
    else if (!genderMatch(me, p)) hidden.push({ p, reason: "gender" });
    else if (locationScore(me, p) === 0 && hasCity) hidden.push({ p, reason: "location" });
    else deck.push({ p, score: locationScore(me, p) });
  }
  deck.sort((a, b) => b.score - a.score || a.p.name.toLowerCase().localeCompare(b.p.name.toLowerCase()));
  return { deck: deck.map((d) => d.p), hidden };
}

/** The bundled negotiation of a pair (either order), if there is one. */
export function pairId(scenarios: Scenarios | null, a: string, b: string): string | null {
  return scenarios?.find.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))?.id ?? null;
}

/** The negotiation behind a like: a live one started for it, else the bundled pair. */
export function swipeNegotiation(scenarios: Scenarios | null, me: string, s: Swipe): string | null {
  return s.negotiation ?? pairId(scenarios, me, s.id);
}

/** What a finished negotiation decided (a stored record, or the stream's "complete" event). */
export type Verdicts = { result?: Outcome | null; analysis?: Analysis | null };

const first = (p: Profile) => p.name.split(" ")[0];
const nonNegotiables = (p: Profile) => ((section(p, "dealbreakers").non_negotiables as string[] | undefined) ?? []);
const smokes = (p: Profile) => section(p, "living").smoking === "I smoke";
const wantsNonSmoking = (p: Profile) => section(p, "living").smoking === "Non-smoking household only" || nonNegotiables(p).some((n) => /smok/i.test(n));
const hasPet = (p: Profile) => section(p, "living").pets === "I have pets";
const noPets = (p: Profile) => nonNegotiables(p).includes("No pets") || ["No pets please", "Allergic to pets"].includes(text(section(p, "living").pets));
const money = (n: number) => `$${n.toLocaleString("en-US")}`;

/**
 * One line for "Your clones didn't click", from the profiles' own answers when the dealbreaker is
 * a known one (smoking, pets, gender, budget); otherwise the first sentence of the verdict.
 */
export function noClickReason(me: Profile, other: Profile, rec: Verdicts | null): string {
  const said = `${rec?.result?.reason ?? ""} ${rec?.analysis?.recommendation_summary ?? ""}`.toLowerCase();
  const reasons: [boolean, string, string][] = [
    [smokes(other) && wantsNonSmoking(me), "smok", `${first(other)} smokes, and you need a non-smoking home.`],
    [smokes(me) && wantsNonSmoking(other), "smok", `You smoke, and ${first(other)} needs a non-smoking home.`],
    [hasPet(other) && noPets(me), "pet", `${first(other)} has a pet, and you can't live with pets.`],
    [hasPet(me) && noPets(other), "pet", `You have a pet, and ${first(other)} can't live with pets.`],
    [!genderMatch(me, other), "gender", `${first(other)} is looking for a same-gender roommate.`],
  ];
  const a = budgetOf(me), b = budgetOf(other);
  if (a.max + a.flex < b.min || b.max + b.flex < a.min) {
    reasons.push([true, "budget", `Your budgets don't overlap: ${money(a.min)}–${money(a.max)} vs ${first(other)}'s ${money(b.min)}–${money(b.max)}.`]);
  }
  const hits = reasons.filter(([ok]) => ok);
  const named = hits.find(([, topic]) => said.includes(topic)) ?? hits[0];
  if (named) return named[2];
  const sentence = (rec?.result?.reason || rec?.analysis?.recommendation_summary || "").split(/(?<=[.!?])\s/)[0].trim();
  return sentence || "Their clones found a dealbreaker.";
}

/** The two or three sub-scores that went best, for the match screen. */
export function topScores(rec: Verdicts | null, n = 3): { label: string; value: number }[] {
  const s = rec?.analysis?.scores;
  if (!s) return [];
  const rows: [keyof typeof s, string][] = [["finances", "Finances"], ["lifestyle", "Lifestyle"], ["personality", "Personality"], ["logistics", "Logistics"]];
  return rows.map(([k, label]) => ({ label, value: s[k] })).sort((x, y) => y.value - x.value).slice(0, n);
}
