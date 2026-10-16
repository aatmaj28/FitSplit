/**
 * The listing's photos per floor plan room, and the paint / floor they show. A plan estimated from
 * photos knows each room's frames; a floor plan listing with a video attached gets them by room type
 * (its bedrooms, largest first, take the video's bedrooms, most photographed first; same for the
 * other types). The 3D view's lived-in look uses the median wall color and the most common floor.
 */
import type { FloorKind, RoomStyle } from "../components/FloorPlan3D/livedIn";
import type { ParsedPlan, Room } from "../types";
import type { MediaJob } from "./api";

const PLAN_TYPE: Record<string, Room["type"] | undefined> = {
  living: "living", kitchen: "kitchen", bedroom: "bedroom", bathroom: "bathroom", dining: "dining", closet: "closet", balcony: "balcony", entry: "foyer",
};
const FLOORS: Record<string, FloorKind> = { hardwood: "hardwood", laminate: "laminate", vinyl: "vinyl", tile: "tile", stone: "stone", carpet: "carpet", concrete: "concrete" };

/** room id -> frame ids of the listing's photos of that room */
export function roomFrames(plan: ParsedPlan, job: MediaJob | null): Record<string, number[]> {
  if (!job) return {};
  if (plan.layout_source === "estimated_from_photos") {
    return Object.fromEntries(plan.rooms.filter((r) => r.frames?.length).map((r) => [r.id, r.frames!]));
  }
  const out: Record<string, number[]> = {};
  const media = job.rooms ?? [];
  for (const t of new Set(media.map((m) => PLAN_TYPE[m.type]).filter(Boolean))) {
    const planRooms = plan.rooms.filter((r) => r.type === t).sort((a, b) => (b.area_sqft_final ?? 0) - (a.area_sqft_final ?? 0));
    const videoRooms = media.filter((m) => PLAN_TYPE[m.type] === t).sort((a, b) => b.frames.length - a.frames.length);
    planRooms.forEach((r, i) => {
      if (videoRooms[i]) out[r.id] = videoRooms[i].frames;
    });
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** room id -> wall paint and floor seen in its photos (rooms without photos are left out) */
export function photoStyles(job: MediaJob | null, frames: Record<string, number[]>): Record<string, RoomStyle> {
  if (!job) return {};
  const tags = new Map(job.tags.map((t) => [t.frame, t]));
  const out: Record<string, RoomStyle> = {};
  for (const [id, ids] of Object.entries(frames)) {
    const ts = ids.map((f) => tags.get(f)).filter((t): t is NonNullable<typeof t> => !!t);
    const walls = ts.map((t) => t.wall_color).filter((c): c is string => !!c && /^#[0-9a-f]{6}$/i.test(c));
    const style: RoomStyle = {};
    if (walls.length) {
      const ch = (k: number) => median(walls.map((c) => parseInt(c.slice(1 + 2 * k, 3 + 2 * k), 16)));
      style.wall = `#${[0, 1, 2].map((k) => ch(k).toString(16).padStart(2, "0")).join("")}`;
    }
    const counts = new Map<FloorKind, number>();
    for (const t of ts) {
      const f = FLOORS[t.flooring];
      if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (top) style.floor = top[0];
    if (style.wall || style.floor) out[id] = { ...style, source: "photos" };
  }
  return out;
}

const cache = new WeakMap<ParsedPlan, WeakMap<MediaJob, { frames: Record<string, number[]>; styles: Record<string, RoomStyle> }>>();

/** Both, cached per plan and job (stable objects for the viewer's memos). */
export function listingLook(plan: ParsedPlan, job: MediaJob | null): { frames: Record<string, number[]>; styles: Record<string, RoomStyle> } {
  if (!job) return { frames: {}, styles: {} };
  let byJob = cache.get(plan);
  if (!byJob) cache.set(plan, (byJob = new WeakMap()));
  let hit = byJob.get(job);
  if (!hit) {
    const frames = roomFrames(plan, job);
    hit = { frames, styles: photoStyles(job, frames) };
    byJob.set(job, hit);
  }
  return hit;
}
