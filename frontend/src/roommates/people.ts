import type { Profile } from "./api";
import { budgetOf } from "./fit";

/** Illustrated avatar written by scripts/make-avatars.mjs (bundled, works offline). */
export const avatarUrl = (id: string) => `/demo/avatars/${id}.svg`;

/** A pale version of a person's color, behind their avatar. */
export function tint(hex: string, amount = 0.78): string {
  const n = parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return "#f1f5f9";
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

export const firstName = (p: { name: string }) => p.name.split(" ")[0];

type Answers = Record<string, unknown>;
const q = (p: Profile, s: string) => ((p.questionnaire as Record<string, Answers | undefined>)[s] ?? {}) as Answers;

const MOVE_IN: Record<string, string> = { ASAP: "ASAP", "Within 1 month": "Within a month", "1–3 months": "In 1–3 months", "3–6 months": "In 3–6 months", Flexible: "Flexible" };
const SLEEP: Record<string, string> = { "Early bird (sleep before 10pm)": "Early bird", "Night owl (sleep after midnight)": "Night owl", "Somewhere in between": "In between", "Varies a lot": "Varies" };
const GUESTS: Record<string, string> = { "Never / very rarely": "Rarely", "Occasionally (once a month or less)": "Monthly", "Regularly (weekly)": "Weekly", "Partner stays over frequently": "Partner often" };

/** The facts on a Discover card, short enough for a phone. */
export function cardFacts(p: Profile): { label: string; value: string }[] {
  const b = budgetOf(p);
  const living = q(p, "living"), routines = q(p, "routines"), social = q(p, "social");
  const s = (v: unknown) => String(v ?? "");
  return [
    { label: "Budget", value: `$${b.min.toLocaleString("en-US")}–${b.max.toLocaleString("en-US")}` },
    { label: "Move in", value: MOVE_IN[s(living.move_in_date)] ?? s(living.move_in_date) },
    { label: "Sleep", value: SLEEP[s(routines.sleep_schedule)] ?? s(routines.sleep_schedule) },
    { label: "Tidy", value: `${s(routines.cleanliness) || "?"}/5` },
    { label: "Guests", value: GUESTS[s(social.overnight_guests)] ?? s(social.overnight_guests) },
  ].filter((f) => f.value);
}

/** Hobbies as fun tags ("Cooking South Indian food, badminton" -> two tags). */
export function funTags(p: Profile, max = 4): string[] {
  return String(q(p, "lifestyle").hobbies ?? "").split(/,|;/).map((t) => t.trim()).filter(Boolean).slice(0, max).map((t) => t[0].toUpperCase() + t.slice(1));
}

/** Their top priorities, shortened ("Similar cleanliness standards" -> "cleanliness"). */
export function topPriorities(p: Profile, max = 3): string[] {
  const short: Record<string, string> = {
    "Similar cleanliness standards": "Cleanliness", "Respectful of quiet/work time": "Quiet time", "Budget compatibility": "Budget",
    "Compatible sleep schedule": "Sleep schedule", "Honest communication style": "Honest talk", "Matching social energy": "Social energy",
    "Location match": "Location", "Similar guest/party preferences": "Guests and parties",
  };
  return ((q(p, "dealbreakers").top_priorities as string[] | undefined) ?? []).slice(0, max).map((t) => short[t] ?? t);
}
