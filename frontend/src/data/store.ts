/**
 * One shared mock data store for both portals and the guided demo, so names, units and rents are
 * the same everywhere: the agent's listings (LeaseHub), the students' matched group (Roombae),
 * group applications (Roombae -> LeaseHub), showing requests and the Discover swipes. Kept in localStorage;
 * resetDemo() restores the seeded state (and clears furniture layouts and roommate names).
 */
import { useSyncExternalStore } from "react";
import type { Verdict } from "../roommates/api";
import type { Swipe, SwipeDir } from "../roommates/deck";

export interface AppMember {
  profileId: string | null;
  name: string;
  roomId: string;
  roomLabel: string;
  share: number;
}

export interface Application {
  id: string;
  listingId: string;
  members: AppMember[];
  rent: number;
  method: "fair" | "size";
  rentCheck: { verdict: "ok" | "warn"; note: string } | null;
  compatibility: { status: Verdict; pairs: { a: string; b: string; status: Verdict; overall: number | null }[] } | null;
  message: string;
  submittedAt: string;
  status: "new" | "reviewing" | "approved";
  sample?: boolean;
}

export interface AgentListing {
  id: string; // plan name; listings created from an upload use the parsed plan's name
  status: "published" | "draft";
  publishedAt: string;
  syndicated: string[];
  views3d: number; // sample numbers, labelled as such in the UI
  custom?: { title: string; rent: number; beds: number; baths: number; sqft: number; imageUrl?: string };
}

export interface Showing {
  id: string;
  listingId: string;
  name: string;
  when: string;
  note: string;
  status: "requested" | "confirmed";
}

export interface DemoState {
  version: number;
  listings: AgentListing[];
  applications: Application[];
  showings: Showing[];
  group: { members: string[]; listingId: string | null } | null;
  /** Discover: who the demo student swiped on, in order */
  swipes: Swipe[];
}

const VERSION = 1;
const KEY = "fitsplit.demo.v1";
export const SYNDICATION = ["Zillow", "Zumper", "Apartments.com", "YGL"];

export function seedState(): DemoState {
  const listed = (id: string, publishedAt: string, views3d: number): AgentListing => ({ id, status: "published", publishedAt, syndicated: SYNDICATION, views3d });
  return {
    version: VERSION,
    listings: [
      listed("jvue_3bed", "2026-10-14", 12),
      listed("longwood_2bed", "2026-10-02", 64),
      listed("missionmain_3bed", "2026-10-05", 41),
      listed("jvue_1bed", "2026-10-07", 22),
      listed("longwood_1bed", "2026-10-08", 18),
      listed("serenity_1bed", "2026-10-09", 27),
    ],
    applications: [
      {
        id: "app_sample_1", listingId: "longwood_2bed", rent: 3450, method: "fair", sample: true,
        members: [
          { profileId: null, name: "Maya L.", roomId: "r9", roomLabel: "Master Bedroom", share: 1787 },
          { profileId: null, name: "Chris P.", roomId: "r11", roomLabel: "Second Bedroom", share: 1663 },
        ],
        rentCheck: { verdict: "ok", note: "Inputs match the floor plan" }, compatibility: null,
        message: "Applied directly, without Roombae matching.", submittedAt: "2026-10-09T15:20:00Z", status: "approved",
      },
    ],
    showings: [
      { id: "sh1", listingId: "missionmain_3bed", name: "Three BU students", when: "Thu 5:30pm", note: "Asked about bedroom sizes, answered by the 3D view", status: "confirmed" },
      { id: "sh2", listingId: "longwood_2bed", name: "Grad student couple", when: "Sat 11:00am", note: "Want to see the closets", status: "requested" },
      { id: "sh3", listingId: "serenity_1bed", name: "Visiting researcher", when: "Mon 6:00pm", note: "Virtual tour first", status: "requested" },
    ],
    group: null,
    swipes: [],
  };
}

function load(): DemoState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (s?.version === VERSION) return { ...s, swipes: s.swipes ?? [] } as DemoState;
  } catch {
    /* storage blocked or corrupt: start from the seed */
  }
  return seedState();
}

let state: DemoState = load();
const listeners = new Set<() => void>();

function commit(next: DemoState) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode: keep it in memory */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDemo(): DemoState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function getDemo(): DemoState {
  return state;
}

export const demo = {
  setGroup(members: string[], listingId: string | null = null) {
    commit({ ...state, group: { members, listingId } });
  },
  chooseListing(listingId: string) {
    commit({ ...state, group: state.group ? { ...state.group, listingId } : { members: [], listingId } });
  },
  publish(listing: AgentListing) {
    commit({ ...state, listings: [listing, ...state.listings.filter((l) => l.id !== listing.id)] });
  },
  submitApplication(app: Omit<Application, "id" | "submittedAt" | "status">): Application {
    const full: Application = { ...app, id: `app_${Date.now().toString(36)}`, submittedAt: new Date().toISOString(), status: "new" };
    commit({ ...state, applications: [full, ...state.applications.filter((a) => !(a.listingId === app.listingId && !a.sample && a.status === "new"))] });
    return full;
  },
  swipe(id: string, dir: SwipeDir, negotiation?: string) {
    const s: Swipe = { id, dir, at: new Date().toISOString(), ...(negotiation ? { negotiation } : {}) };
    commit({ ...state, swipes: [...state.swipes.filter((x) => x.id !== id), s] });
  },
  setSwipeNegotiation(id: string, negotiation: string) {
    commit({ ...state, swipes: state.swipes.map((x) => (x.id === id ? { ...x, negotiation } : x)) });
  },
  unswipe(id: string) {
    commit({ ...state, swipes: state.swipes.filter((x) => x.id !== id) });
  },
  clearSwipes() {
    commit({ ...state, swipes: [] });
  },
    setApplicationStatus(id: string, status: Application["status"]) {
    commit({ ...state, applications: state.applications.map((a) => (a.id === id ? { ...a, status } : a)) });
  },
  reset() {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k === KEY || k.startsWith("fp3d.layout.") || k.startsWith("rentsplit.names.") || k.startsWith("fitsplit.")) localStorage.removeItem(k);
      }
    } catch {
      /* ignore */
    }
    commit(seedState());
  },
};
