/**
 * "Lived-in" look: painted walls and real floor materials instead of the plan's type colors, and an
 * optional furnished view. Colors and materials come from the listing's photos when it has them
 * (see media/style.ts), otherwise from a soft per-room palette. Textures are drawn on a canvas, so
 * this works offline and adds no assets.
 */
import * as THREE from "three";
import type { RoomType } from "../../types";
import { autoPlace, type FitChecker, type FurnitureItem, type FurnitureKind } from "./furniture";
import type { PlanModel } from "./geometry";

export type FloorKind = "hardwood" | "laminate" | "vinyl" | "tile" | "stone" | "carpet" | "concrete" | "deck";
export interface RoomStyle {
  wall?: string; // "#rrggbb"
  floor?: FloorKind;
  /** where the style came from, for the legend */
  source?: "photos" | "palette";
}

/** Soft paint per room type (warm whites, a hint of color). */
export const SOFT_WALLS: Record<RoomType, string> = {
  bedroom: "#e7e3ee",
  bathroom: "#e3eef0",
  kitchen: "#efebe2",
  living: "#eee8dd",
  dining: "#efe6da",
  closet: "#ebe7e1",
  balcony: "#e6e2da",
  foyer: "#ebe6ee",
  other: "#ece9e3",
};

export const DEFAULT_FLOOR: Record<RoomType, FloorKind> = {
  bedroom: "hardwood", living: "hardwood", dining: "hardwood", foyer: "hardwood", closet: "hardwood", other: "hardwood",
  kitchen: "tile", bathroom: "tile", balcony: "deck",
};

export const FLOOR_LABEL: Record<FloorKind, string> = {
  hardwood: "Hardwood", laminate: "Laminate", vinyl: "Vinyl", tile: "Tile", stone: "Stone", carpet: "Carpet", concrete: "Concrete", deck: "Deck",
};
export const FLOOR_SWATCH: Record<FloorKind, string> = {
  hardwood: "#c89b6d", laminate: "#cdb79a", vinyl: "#c9c2b6", tile: "#e7e5e1", stone: "#cfcac2", carpet: "#cfc6b8", concrete: "#c8c8c4", deck: "#c9a77c",
};

/** Paint from a photo can come out dark or grey (lighting); keep it a light, wall-like tone. */
export function wallTone(hex: string): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(hsl.s, 0.35), Math.max(hsl.l, 0.78));
  return `#${c.getHexString()}`;
}

export function styleOf(type: RoomType, override?: RoomStyle): Required<RoomStyle> {
  return {
    wall: override?.wall ? wallTone(override.wall) : SOFT_WALLS[type] ?? SOFT_WALLS.other,
    floor: override?.floor ?? DEFAULT_FLOOR[type] ?? "hardwood",
    source: override?.wall || override?.floor ? "photos" : "palette",
  };
}

// ----------------------------------------------------------------------------- floor textures

const textures = new Map<FloorKind, THREE.CanvasTexture>();

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function planks(ctx: CanvasRenderingContext2D, tones: string[], seam: string, rand: () => number) {
  const rows = 8; // 6" boards on a 4 ft tile
  for (let r = 0; r < rows; r++) {
    let x = -Math.floor(rand() * 128);
    while (x < 256) {
      const len = 70 + Math.floor(rand() * 120);
      ctx.fillStyle = tones[Math.floor(rand() * tones.length)];
      ctx.fillRect(x, r * 32, len, 32);
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      for (let g = 0; g < 4; g++) ctx.fillRect(x, r * 32 + 4 + Math.floor(rand() * 24), len, 1); // grain
      ctx.fillStyle = seam;
      ctx.fillRect(x + len - 1, r * 32, 1, 32);
      x += len;
    }
    ctx.fillStyle = seam;
    ctx.fillRect(0, r * 32 + 31, 256, 1);
  }
}

function speckle(ctx: CanvasRenderingContext2D, base: string, dots: string[], n: number, rand: () => number, size = 2) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = dots[i % dots.length];
    ctx.fillRect(Math.floor(rand() * 256), Math.floor(rand() * 256), size, size);
  }
}

/** One canvas texture per material; `repeat` maps it to feet on the floor (ShapeGeometry UVs are feet). */
export function floorTexture(kind: FloorKind): THREE.CanvasTexture {
  const hit = textures.get(kind);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const rand = rng(7 + kind.length);
  let feet = 4;
  switch (kind) {
    case "hardwood":
    case "deck":
      planks(ctx, kind === "deck" ? ["#c9a77c", "#c39f73", "#cfae84", "#bf9a6d"] : ["#c8996a", "#be8f61", "#cda274", "#b98a5b", "#c49568"], "rgba(70,45,20,0.35)", rand);
      break;
    case "laminate":
    case "vinyl":
      planks(ctx, kind === "vinyl" ? ["#cdc6ba", "#c6beb1", "#d3ccc1"] : ["#d2bc9e", "#c9b394", "#d8c3a6"], "rgba(60,50,40,0.25)", rand);
      break;
    case "tile":
    case "stone": {
      feet = 2; // 12" tiles, 2 x 2 per texture
      ctx.fillStyle = kind === "tile" ? "#e9e7e3" : "#d3cec6";
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = `rgba(0,0,0,${0.015 + rand() * 0.04})`;
          ctx.fillRect(i * 128 + 3, j * 128 + 3, 122, 122);
        }
      ctx.fillStyle = kind === "tile" ? "#bdb8b0" : "#a9a299";
      for (const v of [0, 127, 255]) {
        ctx.fillRect(v - 1, 0, 3, 256);
        ctx.fillRect(0, v - 1, 256, 3);
      }
      break;
    }
    case "carpet":
      feet = 2;
      speckle(ctx, "#d2c9bb", ["#c4baa9", "#ddd5c9", "#bfb4a3", "#d8cfc2"], 9000, rand);
      break;
    case "concrete":
      feet = 6;
      speckle(ctx, "#cbcac5", ["#bdbcb6", "#d6d5d0", "#c2c1bb"], 4000, rand, 3);
      break;
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.repeat.set(1 / feet, 1 / feet);
  textures.set(kind, t);
  return t;
}

// ----------------------------------------------------------------------------- furnished view

const K = (kind: string, name: string, w: number, d: number, h: number, color: string): FurnitureKind => ({ kind, name, w, d, h, color });
const BED = { queen: K("queen_bed", "Queen bed", 60, 80, 24, "#e9e3d8"), full: K("full_bed", "Full bed", 54, 75, 24, "#e9e3d8"), twin: K("twin_bed", "Twin bed", 39, 75, 24, "#e9e3d8") };
const WOOD = "#a47c58";
const SETS: Partial<Record<RoomType, (area: number) => FurnitureKind[]>> = {
  bedroom: (a) => [a >= 130 ? BED.queen : a >= 95 ? BED.full : BED.twin, K("nightstand", "Nightstand", 20, 16, 24, WOOD), K("dresser", "Dresser", 54, 18, 34, WOOD),
    ...(a >= 125 ? [K("desk", "Desk", 44, 22, 30, "#b88a5e"), K("desk_chair", "Desk chair", 22, 22, 34, "#6b7280")] : [])],
  living: (a) => [K("sofa", "Sofa", 84, 36, 34, "#7d8ca3"), K("coffee_table", "Coffee table", 44, 22, 17, "#8b6b4a"), K("tv_stand", "TV stand", 56, 16, 22, "#6b5848"),
    ...(a >= 170 ? [K("armchair", "Armchair", 32, 32, 33, "#c08a6b")] : []), ...(a >= 220 ? [K("bookshelf", "Bookshelf", 36, 12, 72, WOOD)] : [])],
  dining: () => [K("dining_table", "Dining table", 48, 30, 30, "#9c7350")],
  kitchen: (a) => (a >= 120 ? [K("dining_table", "Small table", 30, 30, 30, "#9c7350")] : []),
};

/** Furniture for every room, placed with the fit check (never in front of a doorway). Not saved. */
export function furnish(model: PlanModel, checker: FitChecker): FurnitureItem[] {
  const items: FurnitureItem[] = [];
  for (const { room } of model.rooms) {
    const set = SETS[room.type];
    const area = room.area_sqft_final ?? room.area_sqft ?? 0;
    if (!set || area < 40) continue;
    const { placed, blocking } = autoPlace(set(area), room.id, items, checker);
    const blocked = new Set(blocking.map((b) => b.id));
    items.push(...placed.filter((p) => !blocked.has(p.id)));
  }
  return items;
}
