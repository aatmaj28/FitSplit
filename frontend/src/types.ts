/** Shape of the backend's parsed floor plan JSON (only the fields the viewer uses are required). */
export type Pt = [number, number];

export type RoomType =
  | "bedroom"
  | "bathroom"
  | "kitchen"
  | "living"
  | "dining"
  | "closet"
  | "balcony"
  | "foyer"
  | "other";

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  label_point: Pt; // original-image px
  printed_dims_ft: { w: number; l: number } | null;
  printed_dims_text?: string | null;
  area_sqft: number | null; // measured
  area_sqft_final: number | null; // printed when available, else measured
  area_source: "printed" | "measured" | null;
  has_private_bath: boolean | null;
  polygon: Pt[] | null; // original-image px
  segmentation?: string;
  closet_ids?: string[];
  shared_region_with?: string[];
  area_with_closets_sqft?: number | null;
}

export interface Wall {
  id: string;
  polygon: Pt[];
  holes?: Pt[][];
}

export interface Unit {
  total_sqft: number | null;
  beds: number | null;
  baths: number | null;
  rent: number | null;
}

export interface ParsedPlan {
  plan_name?: string;
  source_image: string;
  image_size: { w: number; h: number };
  semantics_provider: string;
  semantics_model?: string;
  scale: { pixels_per_foot: number | null; method: string | null; notes: string };
  walls: Wall[];
  rooms: Room[];
  footprint?: Pt[][];
  unit: Unit;
  warnings: string[];
  cached?: boolean;
}

export interface PlanSummary {
  name: string;
  source_image?: string | null;
  unit: Unit;
  rooms?: number;
  semantics_provider?: string;
  thumbnail_url?: string;
}
