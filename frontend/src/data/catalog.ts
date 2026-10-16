/**
 * Every listing renters can see: the six floor-plan listings, plus listings an agent created from a
 * video or photos (LeaseHub "Video or photos"), with whatever media (amenities, description, photos)
 * the agent attached.
 */
import { LISTINGS, type Listing } from "./listings";
import { useDemo, type AgentListing, type ListingMedia } from "./store";

export interface CatalogListing extends Listing {
  media?: ListingMedia;
  /** a parsed floor plan exists (3D view, rent split, furniture fit) */
  hasPlan: boolean;
  /** created from a video / photos (no parsed floor plan) */
  fromMedia: boolean;
}

export function toCatalog(a: AgentListing): CatalogListing | undefined {
  const base = LISTINGS.find((l) => l.id === a.id);
  if (base) return { ...base, media: a.media, hasPlan: true, fromMedia: false };
  if (a.custom && a.media) {
    const c = a.custom;
    return { id: a.id, title: c.title, location: c.location || "Boston, MA", beds: c.beds, baths: c.baths, sqft: c.sqft, rent: c.rent, image: "", media: a.media, hasPlan: false, fromMedia: true };
  }
  return undefined;
}

/** Published listings renters can open, floor-plan listings first. */
export function useCatalog(): CatalogListing[] {
  const { listings } = useDemo();
  const live = listings.filter((a) => a.status === "published");
  const fixed = LISTINGS.filter((l) => live.some((a) => a.id === l.id)).map((l) => toCatalog(live.find((a) => a.id === l.id)!)!);
  const fromMedia = live.filter((a) => !LISTINGS.some((l) => l.id === a.id)).map(toCatalog).filter((x): x is CatalogListing => !!x);
  return [...fixed, ...fromMedia];
}

/** One listing by id (published or not, so a link from the agent side always opens). */
export function useCatalogListing(id: string | undefined): CatalogListing | undefined {
  const { listings } = useDemo();
  if (!id) return undefined;
  const a = listings.find((x) => x.id === id);
  if (a) return toCatalog(a);
  const base = LISTINGS.find((l) => l.id === id);
  return base && { ...base, hasPlan: true, fromMedia: false };
}
