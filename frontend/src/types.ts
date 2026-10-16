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
  area_source: "printed" | "measured" | "estimated" | null;
  has_private_bath: boolean | null;
  polygon: Pt[] | null; // original-image px
  segmentation?: string;
  closet_ids?: string[];
  shared_region_with?: string[];
  area_with_closets_sqft?: number | null;
  /** plans estimated from photos: how sure the size is, and how it was worked out */
  dims_confidence?: { confidence: "low" | "medium" | "high"; plus_minus_pct: number; reasoning?: string; references?: string[]; source?: string; frames?: number[] };
  media_type?: string;
  frames?: number[];
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
  /** floor inside the unit that no room covers (halls), opened so wall-side slivers are gone */
  hallways?: { polygon: Pt[]; area_sqft: number }[];
  /** door / window gaps the parser found in the walls (original-image px) */
  openings?: Opening[];
  unit: Unit;
  warnings: string[];
  cached?: boolean;
  /** a schematic plan built from a listing video / photos (sizes from reference objects) */
  layout_source?: "estimated_from_photos";
  estimate?: { plus_minus_pct: number; rooms_sized: number; rooms: number; method: string };
  /** which layout engine built it ("combined" | "tanvi" | "fitsplit"), its credit line and notes */
  layout_engine?: string;
  credit?: string;
  notes?: string;
}

export interface PlanSummary {
  name: string;
  source_image?: string | null;
  unit: Unit;
  rooms?: number;
  semantics_provider?: string;
  thumbnail_url?: string;
}

export interface Opening {
  id: string;
  kind: "door" | "window" | "opening"; // opening: wider than a door (archway, open-plan boundary)
  axis: "h" | "v"; // h: gap in a horizontal wall (spans x), v: in a vertical wall (spans y)
  polygon: Pt[]; // rectangle in original-image px
  width_ft: number;
}
