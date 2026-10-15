/** Fair rent split from a parsed plan (pure functions, no UI). */
import type { ParsedPlan, Pt, Room } from "./types";

export type SplitMethod = "fair" | "size";

export interface SplitOptions {
  method: SplitMethod;
  includeClosets: boolean;
  rent: number;
}

export interface SplitRow {
  room: Room;
  bedroomArea: number; // sq ft used for the bedroom itself
  privateBath: Room | null;
  privateBathArea: number; // counted only by the fair split
  weight: number; // area this room is charged for
  exact: number; // dollars before rounding
  share: number; // whole dollars; shares sum to the rent exactly
  vsEven: number; // share minus rent / bedrooms
}

export interface SplitResult {
  rows: SplitRow[];
  rent: number;
  totalSqft: number | null;
  privateSqft: number;
  privateFraction: number; // fair split: share of the unit that is private
  privatePortion: number;
  sharedPortion: number;
  sharedEach: number;
  notes: string[];
}

/** Hamilton / largest-remainder rounding: whole dollars that add up to `total` exactly. */
export function roundToTotal(values: number[], total: number): number[] {
  const target = Math.round(total);
  const floors = values.map(Math.floor);
  let left = target - floors.reduce((a, b) => a + b, 0);
  const order = values.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const out = [...floors];
  for (let k = 0; left !== 0 && order.length; k = (k + 1) % order.length) {
    out[order[k][1]] += left > 0 ? 1 : -1;
    left += left > 0 ? -1 : 1;
  }
  return out;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Smallest gap between two polygon outlines (vertex-to-edge both ways), in the polygons' units. */
export function polygonGap(a: Pt[], b: Pt[]): number {
  let best = Infinity;
  for (const [p, q] of [[a, b], [b, a]] as const)
    for (const v of p) for (let i = 0, j = q.length - 1; i < q.length; j = i++) best = Math.min(best, segDist(v, q[j], q[i]));
  return best;
}

/** The bathroom a bedroom with has_private_bath opens into: the nearest bathroom within 10 ft. */
export function findPrivateBath(plan: ParsedPlan, bedroom: Room): Room | null {
  if (!bedroom.has_private_bath || !bedroom.polygon) return null;
  const ppf = plan.scale.pixels_per_foot || 30;
  let best: { room: Room; gap: number } | null = null;
  for (const r of plan.rooms) {
    if (r.type !== "bathroom" || !r.polygon) continue;
    const gap = polygonGap(bedroom.polygon, r.polygon) / ppf;
    if (gap <= 10 && (!best || gap < best.gap)) best = { room: r, gap };
  }
  return best?.room ?? null;
}

export function bedrooms(plan: ParsedPlan): Room[] {
  return plan.rooms.filter((r) => r.type === "bedroom" && (r.area_sqft_final ?? r.area_sqft) != null);
}

export function computeSplit(plan: ParsedPlan, { method, includeClosets, rent }: SplitOptions): SplitResult {
  const notes: string[] = [];
  const beds = bedrooms(plan);
  const n = beds.length;
  const area = (r: Room) => (includeClosets ? (r.area_with_closets_sqft ?? r.area_sqft_final) : r.area_sqft_final) ?? r.area_sqft ?? 0;

  const rows: SplitRow[] = beds.map((room) => {
    const bath = method === "fair" ? findPrivateBath(plan, room) : null;
    if (method === "fair" && room.has_private_bath && !bath) notes.push(`${room.name}: private bath not located on the plan, not counted`);
    const bathArea = bath ? (bath.area_sqft_final ?? bath.area_sqft ?? 0) : 0;
    const bedroomArea = area(room);
    return { room, bedroomArea, privateBath: bath, privateBathArea: bathArea, weight: bedroomArea + bathArea, exact: 0, share: 0, vsEven: 0 };
  });
  const privateSqft = rows.reduce((s, r) => s + r.weight, 0);

  let totalSqft = plan.unit.total_sqft;
  if (method === "fair" && !totalSqft) {
    totalSqft = plan.rooms.filter((r) => r.type !== "balcony").reduce((s, r) => s + (r.area_sqft_final ?? r.area_sqft ?? 0), 0);
    notes.push("No total sq ft for this unit; using the sum of all rooms instead");
  }

  let privateFraction = 0, privatePortion = 0, sharedPortion = 0, sharedEach = 0;
  if (n && privateSqft > 0) {
    if (method === "fair") {
      privateFraction = Math.min(1, privateSqft / (totalSqft || privateSqft));
      privatePortion = rent * privateFraction;
      sharedPortion = rent - privatePortion;
      sharedEach = sharedPortion / n;
      rows.forEach((r) => (r.exact = (privatePortion * r.weight) / privateSqft + sharedEach));
    } else {
      rows.forEach((r) => (r.exact = (rent * r.weight) / privateSqft));
    }
    const shares = roundToTotal(rows.map((r) => r.exact), rent);
    rows.forEach((r, i) => {
      r.share = shares[i];
      r.vsEven = Math.round(shares[i] - rent / n);
    });
  }
  return { rows, rent, totalSqft, privateSqft, privateFraction, privatePortion, sharedPortion, sharedEach, notes };
}
