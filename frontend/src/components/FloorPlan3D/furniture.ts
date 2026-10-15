/**
 * Furniture library + fit checking, all in plan feet on the floor plane (x right, z down,
 * the same frame as PlanModel). Intersections use polygon-clipping, so any rotation works.
 */
import pc from "polygon-clipping";
import type { MultiPolygon, Polygon, Ring } from "polygon-clipping";
import type { Pt, RoomType } from "../../types";
import type { ModelOpening, PlanModel } from "./geometry";

export const IN = 1 / 12; // feet per inch
export const GRID_FT = 0.25; // 3 inch snap
/** Footprints are shrunk by this for wall / room tests: drawing + segmentation slack (~1.5"). */
export const TOL_FT = 1.5 / 12;
const EPS_SQFT = 0.02; // overlaps smaller than ~1.7" x 1.7" are noise
const OPEN_FT = 0.3; // no wall this close to a room outline = an opening (door, archway, closet front)
const DOOR_MIN_FT = 1.8; // narrower openings are drawing noise
/** Floor kept clear in front of an opening: auto-place avoids it, the panel warns about it. */
export const CLEAR_FT = 2.5;

export interface FurnitureKind {
  kind: string;
  name: string;
  w: number; // inches
  d: number;
  h: number;
  color: string;
}

export const LIBRARY: FurnitureKind[] = [
  { kind: "twin_bed", name: "Twin bed", w: 39, d: 75, h: 24, color: "#9db7f5" },
  { kind: "full_bed", name: "Full bed", w: 54, d: 75, h: 24, color: "#9db7f5" },
  { kind: "queen_bed", name: "Queen bed", w: 60, d: 80, h: 24, color: "#9db7f5" },
  { kind: "king_bed", name: "King bed", w: 76, d: 80, h: 24, color: "#9db7f5" },
  { kind: "desk", name: "Desk", w: 48, d: 24, h: 30, color: "#f3c987" },
  { kind: "desk_chair", name: "Desk chair", w: 24, d: 24, h: 36, color: "#f0a985" },
  { kind: "dresser", name: "Dresser", w: 60, d: 18, h: 34, color: "#c3b1ec" },
  { kind: "nightstand", name: "Nightstand", w: 20, d: 16, h: 24, color: "#c3b1ec" },
  { kind: "bookshelf", name: "Bookshelf", w: 36, d: 12, h: 72, color: "#a9d18e" },
  { kind: "sofa", name: "Sofa", w: 84, d: 36, h: 34, color: "#eaa6c3" },
  { kind: "dining_table", name: "Dining table", w: 48, d: 30, h: 30, color: "#e9b48f" },
];
export const CUSTOM_COLOR = "#9fc9c4";

export interface FurnitureItem {
  id: string;
  kind: string;
  name: string;
  w: number; // inches, as entered
  d: number;
  h: number;
  x: number; // footprint center, plan feet
  z: number;
  rot: number; // degrees, multiple of 90
  roomId: string | null;
  color: string;
}

export type Issue =
  | { kind: "wall" }
  | { kind: "outside"; into: string[] }
  | { kind: "item"; other: string; otherId: string }
  | { kind: "no_room" };

export interface FitResult {
  ok: boolean;
  issues: Issue[];
  /** Doorways of its room it stands in front of (still fits, just in the way). */
  blocks: Doorway[];
}

/** An opening on a room outline, found from geometry alone (the parser exports no doors). */
export interface Doorway {
  roomId: string;
  to: string | null; // room the probe beyond it landed in (rough: can be a closet next to the door)
  width: number; // ft
  zone: Ring; // clearance rectangle in front of it, CLEAR_FT deep into the room
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Corner ring of the item's footprint (optionally shrunk by `inset` ft on every side). */
export function footprint(it: FurnitureItem, inset = 0): Ring {
  const hw = Math.max(0.01, (it.w * IN) / 2 - inset);
  const hd = Math.max(0.01, (it.d * IN) / 2 - inset);
  const a = (it.rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as Pt[]).map(([u, v]) => [it.x + u * c - v * s, it.z + u * s + v * c]);
}

/** Axis-aligned size of the footprint in feet (rotation is in 90 degree steps). */
export function extent(it: Pick<FurnitureItem, "w" | "d" | "rot">): { sx: number; sz: number } {
  const quarter = Math.round(it.rot / 90) % 2 !== 0;
  return quarter ? { sx: it.d * IN, sz: it.w * IN } : { sx: it.w * IN, sz: it.d * IN };
}

/** Snap the footprint's min corner to a 3" grid anchored at `origin` (the room's corner). */
export function snapCenter(it: Pick<FurnitureItem, "w" | "d" | "rot">, x: number, z: number, origin: Pt): Pt {
  const { sx, sz } = extent(it);
  const snap = (v: number, o: number) => o + Math.round((v - o) / GRID_FT) * GRID_FT;
  return [snap(x - sx / 2, origin[0]) + sx / 2, snap(z - sz / 2, origin[1]) + sz / 2];
}

export function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a) / 2;
}

export function multiArea(m: MultiPolygon): number {
  let a = 0;
  for (const poly of m) {
    if (!poly.length) continue;
    a += ringArea(poly[0]);
    for (const hole of poly.slice(1)) a -= ringArea(hole);
  }
  return Math.max(0, a);
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = dx || dz ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz))) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

function pointInRing([x, y]: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

interface Box { minX: number; minZ: number; maxX: number; maxZ: number }
function boxOf(r: Pt[]): Box {
  const b = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const [x, z] of r) {
    b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
    b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
  }
  return b;
}
const overlaps = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

const OPEN_PLAN: RoomType[] = ["living", "dining", "kitchen", "foyer", "other"];

interface RoomGeo {
  id: string;
  name: string;
  type: RoomType;
  poly: Polygon;
  box: Box;
  area: number; // area_sqft_final (printed if available), else polygon area
  openWith: string[]; // open-plan neighbours: crossing into them is fine
}

/** Precomputed wall/room polygons for one plan. */
export class FitChecker {
  readonly walls: { poly: Polygon; box: Box }[];
  readonly rooms = new Map<string, RoomGeo>();
  private readonly footprint: Pt[][];
  private readonly openings: ModelOpening[];
  private readonly doorCache = new Map<string, Doorway[]>();

  constructor(model: PlanModel) {
    this.walls = model.walls.map((w) => ({ poly: [w.outer as Ring, ...(w.holes as Ring[])], box: boxOf(w.outer) }));
    this.footprint = model.footprint;
    this.openings = model.openings ?? [];
    for (const { room, poly } of model.rooms) {
      this.rooms.set(room.id, {
        id: room.id,
        name: room.name,
        type: room.type,
        poly: [poly as Ring],
        box: boxOf(poly),
        area: room.area_sqft_final ?? ringArea(poly as Ring),
        openWith: [],
      });
    }
    for (const { room } of model.rooms) {
      const me = this.rooms.get(room.id)!;
      if (!OPEN_PLAN.includes(me.type)) continue;
      me.openWith = (room.shared_region_with ?? []).filter((id) => {
        const other = this.rooms.get(id);
        return other && OPEN_PLAN.includes(other.type);
      });
    }
  }

  roomAt(p: Pt): string | null {
    for (const r of this.rooms.values()) if (pointInRing(p, r.poly[0] as Pt[])) return r.id;
    return null;
  }

  private nearWall(p: Pt, r: number): boolean {
    for (const w of this.walls) {
      const b = w.box;
      if (p[0] < b.minX - r || p[0] > b.maxX + r || p[1] < b.minZ - r || p[1] > b.maxZ + r) continue;
      const rings = w.poly as Pt[][];
      if (pointInRing(p, rings[0]) && !rings.slice(1).some((h) => pointInRing(p, h))) return true;
      for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (segDist(p, ring[j], ring[i]) <= r) return true;
    }
    return false;
  }

  /** Doorways of a room: the parser's doors on its walls, plus outline gaps they don't cover (closet
   *  fronts drawn as dashed lines aren't wall gaps to the parser). Cached. */
  doorways(roomId: string): Doorway[] {
    const cached = this.doorCache.get(roomId);
    if (cached) return cached;
    const fromPlan = this.planDoorways(roomId);
    const overlapsPlan = (d: Doorway) =>
      fromPlan.some((p) => overlaps(boxOf(p.zone as Pt[]), boxOf(d.zone as Pt[])) && multiArea(pc.intersection([p.zone], [d.zone])) > 0.5);
    const out = [...fromPlan, ...this.outlineDoorways(roomId).filter((d) => !overlapsPlan(d))];
    this.doorCache.set(roomId, out);
    return out;
  }

  /** The keep-clear strip in front of each parser door / opening that has this room on one side. */
  private planDoorways(roomId: string): Doorway[] {
    const out: Doorway[] = [];
    for (const o of this.openings) {
      if (o.kind === "window") continue;
      const side = o.sides[0] === roomId ? 0 : o.sides[1] === roomId ? 1 : -1;
      if (side < 0) continue;
      const lip = 0.2; // the strip starts a little inside the door gap
      let zone: Ring;
      if (o.axis === "h") {
        const [za, zb] = side === 1 ? [o.z1 - lip, o.z1 + CLEAR_FT] : [o.z0 - CLEAR_FT, o.z0 + lip];
        zone = [[o.x0, za], [o.x1, za], [o.x1, zb], [o.x0, zb]];
      } else {
        const [xa, xb] = side === 1 ? [o.x1 - lip, o.x1 + CLEAR_FT] : [o.x0 - CLEAR_FT, o.x0 + lip];
        zone = [[xa, o.z0], [xb, o.z0], [xb, o.z1], [xa, o.z1]];
      }
      out.push({ roomId, to: o.sides[1 - side], width: o.axis === "h" ? o.x1 - o.x0 : o.z1 - o.z0, zone });
    }
    return out;
  }

  /**
   * Fallback: stretches of the room outline with no wall next to them (doors, archways, closet
   * fronts). Ones that lead out of the building are windows and are dropped.
   */
  private outlineDoorways(roomId: string): Doorway[] {
    const out: Doorway[] = [];
    const room = this.rooms.get(roomId);
    if (room) {
      const ring = room.poly[0] as Pt[];
      const samples: { p: Pt; dir: Pt; open: boolean }[] = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-9) continue;
        const n = Math.max(1, Math.round(len / (2 * IN))); // every 2"
        for (let k = 0; k < n; k++) {
          const p: Pt = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
          samples.push({ p, dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len], open: !this.nearWall(p, OPEN_FT) });
        }
      }
      const runs: (typeof samples)[] = [];
      const start = samples.findIndex((s) => !s.open);
      if (start >= 0) {
        let run: typeof samples = [];
        for (let k = 1; k <= samples.length; k++) {
          const s = samples[(start + k) % samples.length];
          if (s.open) run.push(s);
          else if (run.length) {
            runs.push(run);
            run = [];
          }
        }
      }
      const inside = (q: Pt) => this.footprint.some((f) => pointInRing(q, f));
      for (const run of runs) {
        const a = run[0].p, b = run[run.length - 1].p;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const width = len + 2 * OPEN_FT; // the jambs sit OPEN_FT beyond the open samples
        if (width < DOOR_MIN_FT) continue;
        const u: Pt = len > 0.3 ? [(b[0] - a[0]) / len, (b[1] - a[1]) / len] : run[run.length >> 1].dir;
        const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        let nrm: Pt = [-u[1], u[0]]; // pointing into the room
        if (!pointInRing([mid[0] + nrm[0] * 0.4, mid[1] + nrm[1] * 0.4], ring)) nrm = [-nrm[0], -nrm[1]];
        const m = run[run.length >> 1].p;
        let to: string | null = null, leaves = false;
        for (const d of [1.5, 2.5]) {
          const q: Pt = [m[0] - nrm[0] * d, m[1] - nrm[1] * d];
          const r = this.roomAt(q);
          if (r && r !== roomId) {
            to = r;
            break;
          }
          if (this.footprint.length && !inside(q)) leaves = true;
        }
        if (!to && leaves) continue; // a window in an outside wall
        const a0: Pt = [a[0] - u[0] * OPEN_FT, a[1] - u[1] * OPEN_FT], b0: Pt = [b[0] + u[0] * OPEN_FT, b[1] + u[1] * OPEN_FT];
        const off = (p: Pt, d: number): [number, number] => [p[0] + nrm[0] * d, p[1] + nrm[1] * d];
        const zone: Ring = [off(a0, -0.2), off(b0, -0.2), off(b0, CLEAR_FT), off(a0, CLEAR_FT)];
        out.push({ roomId, to, width, zone });
      }
    }
    return out;
  }

  roomOrigin(roomId: string | null): Pt {
    const r = roomId ? this.rooms.get(roomId) : undefined;
    return r ? [r.box.minX, r.box.minZ] : [0, 0];
  }

  check(it: FurnitureItem, all: FurnitureItem[]): FitResult {
    const issues: Issue[] = [];
    const core: Polygon = [footprint(it, TOL_FT)];
    const coreBox = boxOf(core[0] as Pt[]);
    try {
      for (const w of this.walls) {
        if (overlaps(coreBox, w.box) && multiArea(pc.intersection(core, w.poly)) > EPS_SQFT) {
          issues.push({ kind: "wall" });
          break;
        }
      }
      const room = it.roomId ? this.rooms.get(it.roomId) : undefined;
      if (!room) {
        issues.push({ kind: "no_room" });
      } else {
        let out = pc.difference(core, room.poly);
        const open = room.openWith.map((id) => this.rooms.get(id)!.poly);
        if (multiArea(out) > EPS_SQFT && open.length) out = pc.difference(out, ...open);
        if (multiArea(out) > EPS_SQFT) {
          const into = [...this.rooms.values()]
            .filter((r) => r.id !== room.id && overlaps(coreBox, r.box) && multiArea(pc.intersection(out, r.poly)) > EPS_SQFT)
            .map((r) => r.name);
          issues.push({ kind: "outside", into });
        }
      }
      const fp: Polygon = [footprint(it)];
      const fpBox = boxOf(fp[0] as Pt[]);
      for (const o of all) {
        if (o.id === it.id) continue;
        const ofp: Polygon = [footprint(o)];
        if (overlaps(fpBox, boxOf(ofp[0] as Pt[])) && multiArea(pc.intersection(fp, ofp)) > EPS_SQFT) {
          issues.push({ kind: "item", other: o.name, otherId: o.id });
        }
      }
      const blocks = room
        ? this.doorways(room.id).filter((d) => overlaps(fpBox, boxOf(d.zone as Pt[])) && multiArea(pc.intersection(fp, [d.zone])) > 0.25)
        : [];
      return { ok: issues.length === 0, issues, blocks };
    } catch {
      // polygon-clipping can reject degenerate input; fall back to sampling the footprint
      return this.checkBySampling(it, all);
    }
  }

  /** Conservative fallback: sample points every 3" inside the shrunk footprint. */
  private checkBySampling(it: FurnitureItem, all: FurnitureItem[]): FitResult {
    const issues: Issue[] = [];
    const room = it.roomId ? this.rooms.get(it.roomId) : undefined;
    const ring = footprint(it, TOL_FT) as Pt[];
    const b = boxOf(ring);
    let wall = false, outside = false;
    for (let x = b.minX; x <= b.maxX; x += GRID_FT) {
      for (let z = b.minZ; z <= b.maxZ; z += GRID_FT) {
        if (!pointInRing([x, z], ring)) continue;
        if (!wall && this.walls.some((w) => pointInRing([x, z], w.poly[0] as Pt[]) && !w.poly.slice(1).some((h) => pointInRing([x, z], h as Pt[])))) wall = true;
        if (room && !outside && !pointInRing([x, z], room.poly[0] as Pt[])) outside = true;
      }
    }
    if (wall) issues.push({ kind: "wall" });
    if (!room) issues.push({ kind: "no_room" });
    else if (outside) issues.push({ kind: "outside", into: [] });
    for (const o of all) {
      if (o.id === it.id) continue;
      const a = boxOf(footprint(it) as Pt[]);
      if (overlaps(a, boxOf(footprint(o) as Pt[]))) issues.push({ kind: "item", other: o.name, otherId: o.id });
    }
    return { ok: issues.length === 0, issues, blocks: [] };
  }

  /** Floor left in a room: its area minus the union of the furniture footprints inside it. */
  freeArea(roomId: string, items: FurnitureItem[]): number {
    const room = this.rooms.get(roomId);
    if (!room) return 0;
    const mine = items.filter((i) => i.roomId === roomId);
    if (!mine.length) return room.area;
    try {
      const [first, ...rest] = mine.map((i) => [footprint(i)] as Polygon);
      const used = multiArea(pc.intersection(pc.union(first, ...rest), room.poly));
      return Math.max(0, room.area - used);
    } catch {
      return Math.max(0, room.area - mine.reduce((s, i) => s + i.w * i.d * IN * IN, 0));
    }
  }
}

export function describe(it: FurnitureItem, fit: FitResult | undefined, roomName: string | null): string {
  if (!fit) return it.name;
  if (fit.ok) {
    return `${it.name} fits in ${roomName ?? "the room"} ✓${fit.blocks.length ? ", but blocks a doorway" : ""}`;
  }
  const parts = fit.issues.map((i) => {
    switch (i.kind) {
      case "wall":
        return "hits a wall";
      case "item":
        return `overlaps ${i.other}`;
      case "no_room":
        return "isn't inside a room";
      case "outside":
        return i.into.length ? `sticks out into ${i.into.join(", ")}` : `sticks out of ${roomName ?? "the room"}`;
    }
  });
  return `${it.name} ${[...new Set(parts)].join(", ")}`;
}

/**
 * "Will my stuff fit?": greedy placement on a 3" occupancy grid of the room. Biggest pieces first;
 * each goes where its footprint is fully free and touches the most walls / furniture (corners,
 * against walls), trying both orientations, and keeps the floor in front of doorways clear unless
 * there is no other spot (`blocking`). Every placement is re-verified with the exact check.
 */
export function autoPlace(
  kinds: FurnitureKind[],
  roomId: string,
  existing: FurnitureItem[],
  checker: FitChecker,
): { placed: FurnitureItem[]; failed: FurnitureKind[]; blocking: FurnitureItem[] } {
  const room = checker.rooms.get(roomId);
  if (!room) return { placed: [], failed: kinds, blocking: [] };
  const { minX, minZ, maxX, maxZ } = room.box;
  const nx = Math.max(1, Math.ceil((maxX - minX) / GRID_FT));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / GRID_FT));
  const blocked = new Uint8Array(nx * nz);
  const ring = room.poly[0] as Pt[];
  const occupied = existing.map((it) => footprint(it) as Pt[]);
  const cellFree = (i: number, j: number) => {
    const p: Pt = [minX + (i + 0.5) * GRID_FT, minZ + (j + 0.5) * GRID_FT];
    // a cell is usable if its center is inside the room (with the same slack as the check)
    return pointInRing(p, ring) && !occupied.some((r) => pointInRing(p, r));
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) blocked[j * nx + i] = cellFree(i, j) ? 0 : 1;
  const zones = checker.doorways(roomId).map((d) => d.zone as Pt[]);
  const door = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const p: Pt = [minX + (i + 0.5) * GRID_FT, minZ + (j + 0.5) * GRID_FT];
      door[j * nx + i] = zones.some((z) => pointInRing(p, z)) ? 1 : 0;
    }

  // summed-area tables over the grid padded by one cell (outside counts as blocked, not as doorway)
  const W = nx + 2, H = nz + 2;
  const table = (grid: Uint8Array, outside: number) => {
    const t = new Int32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        const gx = x - 1, gy = y - 1;
        row += gx < 0 || gy < 0 || gx >= nx || gy >= nz ? outside : grid[gy * nx + gx];
        t[(y + 1) * (W + 1) + (x + 1)] = t[y * (W + 1) + (x + 1)] + row;
      }
    }
    return t;
  };
  const sum = (t: Int32Array, x0: number, y0: number, x1: number, y1: number) => // padded coords, inclusive-exclusive
    t[y1 * (W + 1) + x1] - t[y0 * (W + 1) + x1] - t[y1 * (W + 1) + x0] + t[y0 * (W + 1) + x0];
  let sat = table(blocked, 1);
  const doorSat = table(door, 0);

  const placed: FurnitureItem[] = [];
  const failed: FurnitureKind[] = [];
  const blocking: FurnitureItem[] = [];
  const order = [...kinds].sort((a, b) => b.w * b.d - a.w * a.d);
  const search = (k: FurnitureKind, keepDoorsClear: boolean) => {
    let best: { score: number; i: number; j: number; rot: number } | null = null;
    for (const rot of [0, 90]) {
      const { sx, sz } = extent({ ...k, rot });
      const fw = Math.ceil(sx / GRID_FT - 1e-6), fd = Math.ceil(sz / GRID_FT - 1e-6);
      for (let j = 0; j + fd <= nz; j++) {
        for (let i = 0; i + fw <= nx; i++) {
          const px = i + 1, py = j + 1;
          if (sum(sat, px, py, px + fw, py + fd) !== 0) continue;
          if (keepDoorsClear && sum(doorSat, px, py, px + fw, py + fd) !== 0) continue;
          const score = sum(sat, px - 1, py - 1, px + fw + 1, py + fd + 1); // more blocked neighbours = snug against walls / furniture
          if (!best || score > best.score) best = { score, i, j, rot };
        }
      }
    }
    return best;
  };
  for (const k of order) {
    let best = search(k, true);
    const inTheWay = !best;
    best ??= search(k, false);
    if (!best) {
      failed.push(k);
      continue;
    }
    const { sx, sz } = extent({ ...k, rot: best.rot });
    const item: FurnitureItem = {
      id: newId(), kind: k.kind, name: k.name, w: k.w, d: k.d, h: k.h, color: k.color, rot: best.rot, roomId,
      x: minX + best.i * GRID_FT + sx / 2,
      z: minZ + best.j * GRID_FT + sz / 2,
    };
    if (!checker.check(item, [...existing, ...placed]).ok) {
      failed.push(k);
      continue;
    }
    placed.push(item);
    if (inTheWay) blocking.push(item);
    const fw = Math.ceil(sx / GRID_FT - 1e-6), fd = Math.ceil(sz / GRID_FT - 1e-6);
    for (let j = best.j; j < best.j + fd; j++) for (let i = best.i; i < best.i + fw; i++) blocked[j * nx + i] = 1;
    sat = table(blocked, 1);
  }
  return { placed, failed, blocking };
}
