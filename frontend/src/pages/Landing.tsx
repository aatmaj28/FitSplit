import { Link } from "react-router";
import { PRODUCT, PRODUCT_TAGLINE } from "../brand";
import { demo } from "../data/store";

const ENTRIES = [
  {
    to: "/demo",
    title: "Guided demo",
    body: "Six steps, one story: an agent posts a JVUE 3 bed, three students match, check furniture, split the rent and apply.",
    tag: "Start here",
    cls: "bg-teal-600 text-white hover:bg-teal-700",
  },
  {
    to: "/roombae",
    title: "Roombae (renter side)",
    body: "AI roommate clones negotiate first, then the group sees the unit in 3D, checks furniture and gets a fair split.",
    tag: "Students",
    cls: "bg-white text-slate-900 ring-1 ring-slate-200 hover:ring-slate-300",
  },
  {
    to: "/leasehub",
    title: "LeaseHub (agent side)",
    body: "Upload a floor plan once when posting: instant 3D view and room sizes go out with the listing.",
    tag: "Agents",
    cls: "bg-white text-slate-900 ring-1 ring-slate-200 hover:ring-slate-300",
  },
  {
    to: "/dev",
    title: "Parser lab",
    body: "Every parsed plan, uploads and the raw parser output, for the curious.",
    tag: "Under the hood",
    cls: "bg-white text-slate-900 ring-1 ring-slate-200 hover:ring-slate-300",
  },
];

export default function Landing() {
  return (
    <div className="min-h-full bg-gradient-to-b from-teal-50 to-white">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
        <div className="flex items-center gap-2 text-sm font-semibold text-teal-700">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-teal-600 text-white">F</span>
          {PRODUCT}
        </div>
        <h1 className="mt-4 max-w-2xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Floor plan in, 3D apartment out. Then the roommates, the furniture and the rent fall into place.
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">{PRODUCT_TAGLINE} Built for LeaseHub (agents) and Roombae (students).</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {ENTRIES.map((e) => (
            <Link key={e.to} to={e.to} className={`group rounded-2xl p-5 shadow-sm transition ${e.cls}`}>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{e.tag}</div>
              <div className="mt-1 text-lg font-semibold">{e.title} <span aria-hidden className="inline-block transition-transform group-hover:translate-x-0.5">→</span></div>
              <p className="mt-1 text-sm opacity-80">{e.body}</p>
            </Link>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span>Everything here is sample data and works offline.</span>
          <button type="button" onClick={() => demo.reset()} className="rounded-full px-2.5 py-1 ring-1 ring-slate-300 hover:bg-white">
            Reset demo data
          </button>
        </div>
      </div>
    </div>
  );
}
