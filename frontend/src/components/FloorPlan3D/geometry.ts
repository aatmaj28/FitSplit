import * as THREE from "three";
import type { ParsedPlan, Pt, Room } from "../../types";

/** Used only when a plan has no scale (the backend reports why in `scale.notes`). */
export const FALLBACK_PPF = 30;

export interface RoomEntry {
  room: Room;
  poly: Pt[]; // feet, scene (x, z)
  labelAt: Pt; // feet, scene (x, z)
}

export interface PlanModel {
  ppf: number;
  scaleMissing: boolean;
  walls: { outer: Pt[]; holes: Pt[][] }[];
  rooms: RoomEntry[];
  footprint: Pt[][];
  image: { w: number; h: number }; // feet: the original image spans [0, w] x [0, h]
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; cx: number; cz: number; sx: number; sz: number };
}

/**
 * 1 scene unit = 1 foot. Image x -> scene X, image y -> scene Z, so looking straight down
 * with screen-up = -Z shows the plan exactly like the 2D image (no mirroring).
 */
export function buildModel(plan: ParsedPlan): PlanModel {
  const scaleMissing = !plan.scale.pixels_per_foot;
  const ppf = plan.scale.pixels_per_foot || FALLBACK_PPF;
  const ft = ([x, y]: Pt): Pt => [x / ppf, y / ppf];

  const walls = plan.walls.map((w) => ({ outer: w.polygon.map(ft), holes: (w.holes ?? []).map((h) => h.map(ft)) }));
  const rooms = plan.rooms
    .filter((r) => r.polygon && r.polygon.length >= 3)
    .map((r) => {
      const poly = r.polygon!.map(ft);
      return { room: r, poly, labelAt: polylabel(poly) };
    });
  const footprint = (plan.footprint ?? []).map((p) => p.map(ft));

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const grow = ([x, z]: Pt) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  };
  walls.forEach((w) => w.outer.forEach(grow));
  rooms.forEach((r) => r.poly.forEach(grow));
  if (!Number.isFinite(minX)) {
    [minX, minZ, maxX, maxZ] = [0, 0, plan.image_size.w / ppf, plan.image_size.h / ppf];
  }
  return {
    ppf,
    scaleMissing,
    walls,
    rooms,
    footprint,
    image: { w: plan.image_size.w / ppf, h: plan.image_size.h / ppf },
    bounds: {
      minX, maxX, minZ, maxZ,
      cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2,
      sx: maxX - minX, sz: maxZ - minZ,
    },
  };
}

/**
 * Shapes live in the XY plane; we build them at (x, -z) and rotate the geometry by -90deg
 * around X, which maps (x, -z, 0) -> (x, 0, z) and turns the extrusion direction into +Y.
 */
export function shapeFrom(outer: Pt[], holes: Pt[][] = []): THREE.Shape {
  const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  return shape;
}

/** Unit-height extrusion (scale Y for the wall height); groups: 0 = top/bottom caps, 1 = sides. */
export function wallGeometry(outer: Pt[], holes: Pt[][]): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shapeFrom(outer, holes), { depth: 1, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g;
}

export function flatGeometry(poly: Pt[]): THREE.ShapeGeometry {
  const g = new THREE.ShapeGeometry(shapeFrom(poly));
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Procedural deck planks for balconies (no external assets, works offline). */
export function plankTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const tones = ["#c9a77c", "#c39f73", "#cfae84", "#bf9a6d"];
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = tones[i % tones.length];
    ctx.fillRect(0, i * 32, 256, 32);
    ctx.fillStyle = "rgba(90, 60, 30, 0.35)";
    ctx.fillRect(0, i * 32 + 30, 256, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(0.25, 0.25); // one 8-plank tile per 4 ft
  return t;
}

// --- pole of inaccessibility (Mapbox polylabel): a label point well inside any polygon shape

interface Cell { x: number; y: number; h: number; d: number; max: number }

function pointToPolygonDist(x: number, y: number, poly: Pt[]): number {
  let inside = false;
  let minSq = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[j];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    let dx = bx - ax, dy = by - ay;
    let px = ax, py = ay;
    if (dx !== 0 || dy !== 0) {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      px = ax + dx * t;
      py = ay + dy * t;
    }
    dx = x - px;
    dy = y - py;
    minSq = Math.min(minSq, dx * dx + dy * dy);
  }
  return (inside ? 1 : -1) * Math.sqrt(minSq);
}

function cell(x: number, y: number, h: number, poly: Pt[]): Cell {
  const d = pointToPolygonDist(x, y, poly);
  return { x, y, h, d, max: d + h * Math.SQRT2 };
}

export function polylabel(poly: Pt[], precision = 0.1): Pt {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const size = Math.min(maxX - minX, maxY - minY);
  if (size <= 0) return [minX, minY];
  const queue: Cell[] = [];
  for (let x = minX; x < maxX; x += size) for (let y = minY; y < maxY; y += size) queue.push(cell(x + size / 2, y + size / 2, size / 2, poly));
  let best = cell((minX + maxX) / 2, (minY + maxY) / 2, 0, poly);
  while (queue.length) {
    let k = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[k].max) k = i;
    const c = queue.splice(k, 1)[0];
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const h = c.h / 2;
    queue.push(cell(c.x - h, c.y - h, h, poly), cell(c.x + h, c.y - h, h, poly), cell(c.x - h, c.y + h, h, poly), cell(c.x + h, c.y + h, h, poly));
  }
  return [best.x, best.y];
}

/** Even-odd point in polygon test (any units). */
export function pointInPoly([x, y]: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
