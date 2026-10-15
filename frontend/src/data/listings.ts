/**
 * The sample listings: the six parsed floor plans. Facts come only from data/floorplans/meta.json
 * (beds, baths, sq ft, rent) and the parsed plans; no addresses or building details are invented.
 */
import { DEMO } from "../api";

export interface Listing {
  id: string; // plan name, e.g. "jvue_3bed"
  title: string;
  location: string;
  beds: number;
  baths: number;
  sqft: number;
  rent: number;
  image: string; // floor plan image (bundled)
}

const TITLES: Record<string, string> = {
  jvue_3bed: "JVUE 3 bed",
  jvue_1bed: "JVUE 1 bed",
  longwood_2bed: "Longwood 2 bed",
  longwood_1bed: "Longwood 1 bed",
  missionmain_3bed: "Mission Main 3 bed",
  serenity_1bed: "Serenity 1 bed",
};

// meta.json, mirrored here so every page works without the backend
const META: Record<string, { beds: number; baths: number; sqft: number; rent: number }> = {
  jvue_3bed: { beds: 3, baths: 2.5, sqft: 1500, rent: 4200 },
  longwood_2bed: { beds: 2, baths: 1, sqft: 1125, rent: 3450 },
  missionmain_3bed: { beds: 3, baths: 2, sqft: 1427, rent: 4500 },
  jvue_1bed: { beds: 1, baths: 1, sqft: 771, rent: 2650 },
  longwood_1bed: { beds: 1, baths: 1, sqft: 775, rent: 2700 },
  serenity_1bed: { beds: 1, baths: 1, sqft: 713, rent: 4000 },
};

export const LISTINGS: Listing[] = Object.entries(META).map(([id, m]) => ({
  id,
  title: TITLES[id],
  location: "Boston, MA",
  ...m,
  image: `${DEMO}/${id}.png`,
}));

export function listing(id: string | undefined): Listing | undefined {
  return LISTINGS.find((l) => l.id === id);
}

export const money = (v: number) => `$${Math.round(v).toLocaleString()}`;
export const baths = (b: number) => `${b} bath${b === 1 ? "" : "s"}`;
