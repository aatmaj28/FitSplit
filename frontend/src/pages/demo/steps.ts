import { getDemo } from "../../data/store";

export interface Step {
  n: number;
  title: string;
  side: "LeaseHub" | "Roombae";
  hint: string;
  path: () => string;
  matches: (pathname: string, hash: string) => boolean;
}

export const DEMO_LISTING = "jvue_3bed";

export const STEPS: Step[] = [
  {
    n: 1, side: "LeaseHub", title: "Agent posts the listing",
    hint: "Pick the JVUE 3 bed sample plan (or upload jvue_3bed.png): 3D view and room sizes appear instantly. Publish.",
    path: () => "/leasehub/listings/new", matches: (p) => p.startsWith("/leasehub/listings/new"),
  },
  {
    n: 2, side: "Roombae", title: "Students match",
    hint: "Meet all matches: the clones negotiate. Priya, Ananya and Meera click; Jake's smoking ends his chat. Save the group.",
    path: () => `/roombae/roommates?listing=${DEMO_LISTING}`, matches: (p) => p.startsWith("/roombae/roommates"),
  },
  {
    n: 3, side: "Roombae", title: "See it in 3D + furniture fit",
    hint: "Click Bedroom 1, Edit layout, Will my stuff fit? Queen bed + desk + dresser: green. Drag the bed into a wall: red.",
    path: () => `/roombae/listings/${DEMO_LISTING}`, matches: (p, h) => p.startsWith(`/roombae/listings/${DEMO_LISTING}`) && h !== "#rent",
  },
  {
    n: 4, side: "Roombae", title: "Fair rent split + AI check",
    hint: "Bedroom 3 pays $88 more for its own bath. Open the AI check: it spotted the balcony and extra closets. Apply the suggestion.",
    path: () => `/roombae/listings/${DEMO_LISTING}#rent`, matches: (p, h) => p.startsWith(`/roombae/listings/${DEMO_LISTING}`) && h === "#rent",
  },
  {
    n: 5, side: "Roombae", title: "Apply as a group",
    hint: "Names and exact shares are filled in from the split, rooms matched to budgets. Submit.",
    path: () => `/roombae/apply/${DEMO_LISTING}`, matches: (p) => p.startsWith("/roombae/apply"),
  },
  {
    n: 6, side: "LeaseHub", title: "Agent receives it",
    hint: "Every roommate's share, the AI rent check and the clones' compatibility verdict, in one application.",
    path: () => {
      const app = getDemo().applications.find((a) => a.listingId === DEMO_LISTING && !a.sample);
      return app ? `/leasehub/applications/${app.id}` : "/leasehub";
    },
    matches: (p) => p.startsWith("/leasehub/applications") || p === "/leasehub",
  },
];

const KEY = "fitsplit.demo.active";
export function demoActive(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
export function setDemoActive(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
