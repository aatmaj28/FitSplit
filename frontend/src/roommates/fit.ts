/**
 * Group <-> listing fit, exactly: who takes which bedroom so every share stays within that person's
 * budget (max + stated flexibility, same rule as backend/app/roommates/checks.py).
 */
import type { SplitRow } from "../rentSplit";
import type { Profile } from "./api";

const FLEX: [string, number][] = [["Hard limit", 0], ["~$100", 100], ["~$200", 200], ["Fairly flexible", 300]];

export function budgetOf(p: Profile): { min: number; max: number; flex: number } {
  const living = (p.questionnaire.living ?? {}) as Record<string, unknown>;
  const text = String(living.budget_flexibility ?? "");
  const flex = FLEX.find(([k]) => text.includes(k))?.[1] ?? (text ? 300 : 0);
  return { min: Number(living.budget_min ?? 0), max: Number(living.budget_max ?? 0), flex };
}

export interface Assignment {
  person: Profile;
  row: SplitRow;
  label: string; // "Bedroom 2 (DREAM)"
  over: number; // dollars above budget max (0 if within)
  ok: boolean; // within max + flex
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

/** Best assignment of people to bedrooms: everyone within budget if possible, then the least
 *  money over anyone's max, then the largest smallest cushion. null when the head count doesn't match. */
export function assignRooms(people: Profile[], rows: SplitRow[]): { assignment: Assignment[]; fits: boolean } | null {
  if (!people.length || people.length !== rows.length || people.length > 5) return null;
  const label = (r: SplitRow) => `Bedroom ${rows.indexOf(r) + 1} (${r.room.name})`;
  let best: { assignment: Assignment[]; key: number[] } | null = null;
  for (const order of permutations(rows)) {
    const assignment = people.map((person, i) => {
      const b = budgetOf(person);
      const row = order[i];
      return { person, row, label: label(row), over: Math.max(0, row.share - b.max), ok: row.share <= b.max + b.flex };
    });
    // fewest people over budget, then the least anyone is over, then the biggest smallest cushion
    const key = [assignment.filter((a) => !a.ok).length, Math.max(...assignment.map((a) => a.over)), -Math.min(...assignment.map((a) => budgetOf(a.person).max - a.row.share))];
    if (!best || lexLess(key, best.key)) best = { assignment, key };
  }
  return best && { assignment: best.assignment, fits: best.assignment.every((a) => a.ok) };
}
