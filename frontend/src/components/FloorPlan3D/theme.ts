import type { RoomType } from "../../types";

export const ACCENT = "#0d9488"; // teal-600
export const ACCENT_SOFT = "#5eead4"; // teal-300

export const WALL_SIDE = "#e7e1d8"; // light warm gray
export const WALL_CAP = "#d3cbbf"; // tops a shade darker, reads like a cut plan
export const SLAB = "#e9e5df"; // neutral "hallway" floor: shows wherever no room polygon covers the plan
export const GROUND = "#eef1f4";
export const BACKGROUND = "#f8fafc";

export const ROOM_COLORS: Record<RoomType, string> = {
  bedroom: "#c9d5f7",
  bathroom: "#b6e6ee",
  kitchen: "#f6d9b8",
  living: "#cdebd2",
  dining: "#f3e6b5",
  closet: "#e4ded6",
  balcony: "#d9bf98",
  foyer: "#eadff0",
  other: "#e3e6ea",
};

export const ROOM_LABELS: Record<RoomType, string> = {
  bedroom: "Bedroom",
  bathroom: "Bathroom",
  kitchen: "Kitchen",
  living: "Living",
  dining: "Dining",
  closet: "Closet",
  balcony: "Balcony",
  foyer: "Foyer",
  other: "Other",
};

export function formatSqft(v: number | null | undefined): string {
  return v == null ? "-" : `${Math.round(v).toLocaleString()} sq ft`;
}
