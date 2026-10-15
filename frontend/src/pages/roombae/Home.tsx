import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { PRODUCT } from "../../brand";
import { R } from "./RoombaeLayout";

const STEPS = [
  ["Clones talk first", "Your AI clone negotiates budget, sleep, guests and dealbreakers with theirs. Safer intros, no awkward first calls."],
  ["See the room in 3D", "Every listing comes with a 3D floor plan: real room sizes, and you can check that your bed and desk fit."],
  ["Split the rent fairly", "Bigger room or private bath pays a bit more, shared space is split evenly. AI checks the inputs; code does the math."],
];

export default function Home() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [beds, setBeds] = useState("any");
  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (beds !== "any") p.set("beds", beds);
    navigate(`/roombae/listings${p.toString() ? `?${p}` : ""}`);
  };
  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-gradient-to-br from-[#fff1ec] via-white to-violet-50 px-5 py-10 ring-1 ring-orange-100 sm:px-10">
        <h1 className="max-w-2xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Moving to Boston? Find roommates and a room that fits.</h1>
        <p className="mt-2 max-w-xl text-slate-600">For students arriving in Boston: compatible roommates first, then a place where everyone's furniture and budget fit.</p>
        <form onSubmit={search} className="mt-6 flex max-w-2xl flex-col gap-2 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200 sm:flex-row" role="search">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search listings, e.g. JVUE, Longwood" aria-label="Search listings"
            className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#e8553e]/40" />
          <select value={beds} onChange={(e) => setBeds(e.target.value)} aria-label="Bedrooms" className="rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
            <option value="any">Any beds</option>
            <option value="1">1 bed</option>
            <option value="2">2 beds</option>
            <option value="3">3 beds</option>
          </select>
          <button type="submit" className={`rounded-xl px-5 py-2 text-sm font-semibold ${R.primary}`}>Search</button>
        </form>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Link to="/roombae/roommates" className="group rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 hover:ring-[#e8553e]/50">
          <div className={`text-[11px] font-semibold uppercase tracking-wide ${R.text}`}>People first</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">Find roommates <span aria-hidden className="inline-block transition-transform group-hover:translate-x-0.5">→</span></div>
          <p className="mt-1 text-sm text-slate-600">Answer the questionnaire once. Your clone meets other students' clones and brings back a group, a combined budget and listings that fit all of you.</p>
        </Link>
        <Link to="/roombae/fill-room" className="group rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 hover:ring-violet-300">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-600">Apartment first</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">Fill a room <span aria-hidden className="inline-block transition-transform group-hover:translate-x-0.5">→</span></div>
          <p className="mt-1 text-sm text-slate-600">Already have a place with an empty room? Candidates' clones talk to each current roommate about the actual room, its exact rent share and their furniture.</p>
        </Link>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">How it works</h2>
        <ol className="mt-3 grid gap-3 sm:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className={`grid h-7 w-7 place-items-center rounded-full text-sm font-bold ${R.soft}`}>{i + 1}</div>
              <div className="mt-2 font-semibold text-slate-900">{title}</div>
              <p className="mt-1 text-sm text-slate-600">{body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-slate-400">3D floor plans, furniture fit and fair rent split by {PRODUCT}.</p>
      </section>
    </div>
  );
}
