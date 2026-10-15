import type { ReactNode } from "react";
import { Link } from "react-router";
import { PRODUCT, PRODUCT_TAGLINE } from "../brand";
import { demo } from "../data/store";
import { LeaseHubMark, ProductMark, RoombaeMark } from "./portals";

const CARDS: { to: string; tag: string; title: string; body: string; points: string[]; cta: string; mark: ReactNode; cls: string; ctaCls: string; tagCls: string }[] = [
  {
    to: "/roombae",
    tag: "Renter",
    title: "Roombae",
    body: "For students looking for roommates and a place in Boston.",
    points: ["Swipe through students; your AI clones talk first", "See the apartment in 3D and check your furniture", "Fair rent split, then apply as a group"],
    cta: "Open Roombae",
    mark: <RoombaeMark className="h-11 w-11" />,
    cls: "bg-white ring-1 ring-orange-200 hover:ring-orange-300",
    ctaCls: "bg-[#e8553e] text-white group-hover:bg-[#d4452f]",
    tagCls: "text-[#d4452f]",
  },
  {
    to: "/leasehub",
    tag: "Agent",
    title: "LeaseHub",
    body: "For agents posting listings and reviewing applications.",
    points: ["Upload a floor plan once", "The listing gets a 3D view and every room's size", "Receive pre-matched group applications"],
    cta: "Open LeaseHub",
    mark: <LeaseHubMark className="h-11 w-11" />,
    cls: "bg-white ring-1 ring-blue-200 hover:ring-blue-300",
    ctaCls: "bg-blue-600 text-white group-hover:bg-blue-700",
    tagCls: "text-blue-700",
  },
  {
    to: "/demo",
    tag: "3 minutes",
    title: "Guided demo",
    body: "One story across both portals, step by step.",
    points: ["An agent posts a JVUE 3 bed", "Three students match, check furniture and split the rent", "The agent receives their application"],
    cta: "Start the demo",
    mark: <ProductMark className="h-11 w-11 rounded-xl text-xl" />,
    cls: "bg-slate-900 text-white ring-1 ring-slate-900 hover:ring-teal-400",
    ctaCls: "bg-teal-400 text-slate-900 group-hover:bg-teal-300",
    tagCls: "text-teal-300",
  },
];

export default function Landing() {
  return (
    <div className="min-h-full bg-gradient-to-b from-teal-50 to-white">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
        <div className="flex items-center gap-2 text-sm font-semibold text-teal-700">
          <ProductMark className="h-7 w-7 rounded-lg text-sm" />
          {PRODUCT}
        </div>
        <h1 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Floor plan in, 3D apartment out. Then the roommates, the furniture and the rent fall into place.
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">{PRODUCT_TAGLINE} Pick a side, or take the guided tour.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {CARDS.map((c) => (
            <Link key={c.to} to={c.to} data-entry={c.to} className={`group flex min-h-[19rem] flex-col rounded-3xl p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${c.cls}`}>
              <div className="flex items-center justify-between">
                {c.mark}
                <span className={`text-xs font-semibold uppercase tracking-wide ${c.tagCls}`}>{c.tag}</span>
              </div>
              <div className="mt-5 text-2xl font-bold tracking-tight">{c.title}</div>
              <p className="mt-1 text-sm opacity-75">{c.body}</p>
              <ul className="mt-4 space-y-1.5 text-sm">
                {c.points.map((p) => (
                  <li key={p} className="flex gap-2"><span aria-hidden className="opacity-50">•</span><span className="opacity-90">{p}</span></li>
                ))}
              </ul>
              <div className="mt-auto pt-6">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${c.ctaCls}`}>
                  {c.cta} <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span>Everything here is sample data and works offline.</span>
          <button type="button" onClick={() => demo.reset()} className="rounded-full px-2.5 py-1 ring-1 ring-slate-300 hover:bg-white">
            Reset demo data
          </button>
          <Link to="/dev" className="rounded-full px-2.5 py-1 text-slate-500 hover:text-slate-800">Parser lab (under the hood) →</Link>
        </div>
      </div>
    </div>
  );
}
