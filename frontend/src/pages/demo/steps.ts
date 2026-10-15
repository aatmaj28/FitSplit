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
    hint: "Pick the JVUE 3 bed floor plan (or upload jvue_3bed.png): 3D view and room sizes appear instantly. Publish.",
    path: () => "/leasehub/listings/new", matches: (p) => p.startsWith("/leasehub/listings/new"),
  },
  {
    n: 2, side: "Roombae", title: "Students match",
    hint: "Swipe right on Ananya: it's a match. Right on Jake: the clones didn't click (he smokes). Pass Kavya, like Meera, then Find a place together and save the group.",
    path: () => `/roombae/discover?listing=${DEMO_LISTING}`, matches: (p) => /^\/roombae\/(discover|matches|roommates|group-chat)/.test(p),
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
    hint: "Every roommate's room and exact share, next to the listing and its 3D floor plan, in one application. Approve the group.",
    path: () => {
      const app = getDemo().applications.find((a) => a.listingId === DEMO_LISTING && !a.sample);
      return app ? `/leasehub/applications/${app.id}` : "/leasehub";
    },
    // the dashboard is not step 6 (an agent may open it any time); "Next" onto it still shows step 6
    matches: (p) => p.startsWith("/leasehub/applications"),
  },
];

const STEP_KEY = "fitsplit.demo.step";
/** The step the presenter is on (index into STEPS): set by the bar's buttons and by visiting a step's page. */
export function demoStep(): number {
  try {
    const n = Number(sessionStorage.getItem(STEP_KEY));
    return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : 0;
  } catch {
    return 0;
  }
}
export function setDemoStep(i: number): void {
  try {
    sessionStorage.setItem(STEP_KEY, String(i));
  } catch {
    /* ignore */
  }
}

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
    else {
      sessionStorage.removeItem(KEY);
      sessionStorage.removeItem(STEP_KEY);
    }
  } catch {
    /* ignore */
  }
}
