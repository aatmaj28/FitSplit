import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { PRODUCT } from "../brand";
import { demo } from "../data/store";
import { STEPS } from "./demo/steps";
import HeroIllustration from "./landing/HeroIllustration";
import { Faces } from "./landing/cast";
import { FitSplitMark, IconCube, IconFileCheck, IconHeart, IconPlay, IconRefresh, IconRuler, IconSplit, IconUpload } from "./landing/icons";
import { LeaseHubMark, RoombaeMark } from "./portals";

const CORAL = "#e8553e";
const BLUE = "#2563eb";

type Portal = {
  id: string;
  to: string;
  name: string;
  who: string;
  headline: string;
  points: { icon: ReactNode; text: string }[];
  cta: string;
  mark: ReactNode;
  extra: ReactNode;
  card: string;
  glow: string;
  who_: string;
  bullet: string;
  button: string;
};

const PORTALS: Portal[] = [
  {
    id: "roombae",
    to: "/roombae",
    name: "Roombae",
    who: "For renters and students",
    headline: "Find roommates and a room that fits.",
    points: [
      { icon: <IconHeart />, text: "Swipe to meet roommates. Your AI clones talk first." },
      { icon: <IconCube />, text: "See the apartment in 3D and check your furniture fits." },
      { icon: <IconSplit />, text: "Split the rent fairly, then apply together." },
    ],
    cta: "Open Roombae",
    mark: <RoombaeMark className="h-12 w-12 drop-shadow-sm" />,
    extra: (
      <span className="flex items-center gap-2.5 text-xs text-slate-500">
        <Faces />
        <span className="hidden leading-snug sm:block">Priya, Ananya and Meera<br />matched and applied</span>
      </span>
    ),
    card: "bg-gradient-to-br from-[#fff1ec] via-white to-white ring-[#f8d3c8] hover:ring-[#f0a796] hover:shadow-[0_30px_60px_-30px_rgba(232,85,62,0.45)]",
    glow: "bg-[#e8553e]/15",
    who_: "text-[#d4452f]",
    bullet: "bg-white text-[#e8553e] ring-[#f8d3c8]",
    button: "bg-[#e8553e] shadow-[#e8553e]/30 group-hover:bg-[#d4452f] focus-visible:ring-[#e8553e]/35",
  },
  {
    id: "leasehub",
    to: "/leasehub",
    name: "LeaseHub",
    who: "For leasing agents",
    headline: "List once. Get complete group applications.",
    points: [
      { icon: <IconUpload />, text: "Upload a floor plan or a walkthrough video once." },
      { icon: <IconRuler />, text: "Every listing gets a 3D view and real room sizes." },
      { icon: <IconFileCheck />, text: "Receive complete group applications." },
    ],
    cta: "Open LeaseHub",
    mark: <LeaseHubMark className="h-12 w-12 drop-shadow-sm" />,
    extra: (
      <span className="hidden items-center gap-2.5 rounded-2xl bg-white/90 py-1.5 pl-1.5 pr-3 text-xs text-slate-500 shadow-sm ring-1 ring-blue-100 sm:flex">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-blue-50 text-blue-600"><IconFileCheck className="h-4.5 w-4.5" /></span>
        <span className="leading-snug"><span className="font-semibold text-slate-700">New group application</span><br />JVUE 3 bed · 3 renters</span>
      </span>
    ),
    card: "bg-gradient-to-br from-blue-50 via-white to-white ring-blue-100 hover:ring-blue-300 hover:shadow-[0_30px_60px_-30px_rgba(37,99,235,0.45)]",
    glow: "bg-blue-500/15",
    who_: "text-blue-700",
    bullet: "bg-white text-blue-600 ring-blue-100",
    button: "bg-blue-600 shadow-blue-600/30 group-hover:bg-blue-700 focus-visible:ring-blue-600/35",
  },
];

function PortalCard({ p }: { p: Portal }) {
  return (
    <div id={p.id} className={`group relative flex flex-col overflow-hidden rounded-[28px] p-6 shadow-sm ring-1 transition duration-300 hover:-translate-y-1 sm:p-8 ${p.card}`}>
      <div aria-hidden className={`pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full blur-3xl ${p.glow}`} />
      <div className="relative flex items-center gap-3.5">
        {p.mark}
        <div>
          <div className="text-2xl font-bold tracking-tight text-slate-900">{p.name}</div>
          <div className={`text-sm font-semibold ${p.who_}`}>{p.who}</div>
        </div>
      </div>
      <p className="relative mt-6 text-xl font-semibold tracking-tight text-slate-900 sm:text-[22px]">{p.headline}</p>
      <ul className="relative mt-5 space-y-3.5">
        {p.points.map((pt) => (
          <li key={pt.text} className="flex items-start gap-3">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl shadow-sm ring-1 ${p.bullet}`}>{pt.icon}</span>
            <span className="pt-1.5 text-[15px] leading-snug text-slate-700">{pt.text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-4 pt-8">
        {/* the whole card is clickable through the link's ::after */}
        <Link to={p.to} data-entry={p.to}
          className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors after:absolute after:inset-0 after:rounded-[28px] focus-visible:outline-none focus-visible:ring-4 ${p.button}`}>
          {p.cta} <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
        </Link>
        {p.extra}
      </div>
    </div>
  );
}

function TourBanner() {
  return (
    <Link to="/demo" data-entry="/demo"
      className="group flex items-center gap-4 rounded-2xl bg-gradient-to-r from-teal-50 via-white to-white px-4 py-4 shadow-sm ring-1 ring-teal-100 transition hover:shadow-md hover:ring-teal-300 sm:px-6">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-teal-500 text-white shadow-md shadow-teal-600/30 transition-transform group-hover:scale-105">
        <IconPlay className="ml-0.5 h-4.5 w-4.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-slate-900">
          Take the 3 minute tour <span aria-hidden className="inline-block transition-transform group-hover:translate-x-1">→</span>
        </span>
        <span className="block text-sm text-slate-500">One apartment across both portals: post, match, fit, split, apply, receive.</span>
      </span>
      <span aria-hidden className="hidden items-center sm:flex">
        {STEPS.map((s, i) => (
          <span key={s.n} className="flex items-center">
            {i > 0 && <span className="h-px w-3 bg-slate-200" />}
            <span className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: s.side === "Roombae" ? CORAL : BLUE }}>{s.n}</span>
          </span>
        ))}
      </span>
    </Link>
  );
}

export default function Landing() {
  const reduce = useReducedMotion() ?? false;
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(false), 2200);
    return () => clearTimeout(t);
  }, [fresh]);
  const rise = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.55, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } };

  return (
    <div className="relative min-h-full overflow-x-clip bg-white text-slate-900">
      {/* backdrop: soft brand glows and a faint blueprint grid */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[820px]"
        style={{ background: "radial-gradient(46rem 30rem at 8% -4%, rgba(45,212,191,0.22), transparent 70%), radial-gradient(38rem 26rem at 96% 6%, rgba(37,99,235,0.08), transparent 70%), radial-gradient(34rem 22rem at 62% 78%, rgba(232,85,62,0.07), transparent 70%)" }} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[820px]"
        style={{
          backgroundImage: "linear-gradient(to right, rgba(15,23,42,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.045) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 80% 65% at 30% 0%, #000 35%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 65% at 30% 0%, #000 35%, transparent 100%)",
        }} />

      {/* hero */}
      <header className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-10 pt-10 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:gap-12 lg:pb-16 lg:pt-16">
        <div>
          <motion.h1 {...rise(0)} className="flex items-center gap-3.5 sm:gap-4">
            <FitSplitMark className="h-14 w-14 shrink-0 drop-shadow-[0_10px_18px_rgba(13,148,136,0.35)] sm:h-[72px] sm:w-[72px]" />
            <span className="text-[56px] font-extrabold leading-none tracking-[-0.045em] sm:text-7xl">
              Fit<span className="bg-gradient-to-br from-teal-500 to-teal-700 bg-clip-text text-transparent">Split</span>
            </span>
          </motion.h1>
          <motion.p {...rise(0.08)} className="mt-7 text-3xl font-bold leading-[1.12] tracking-tight text-slate-900 sm:text-[40px]">
            One floor plan.<br />
            <span className="text-teal-600">Everything fits.</span>
          </motion.p>
          <motion.p {...rise(0.16)} className="mt-5 max-w-xl text-[17px] leading-relaxed text-slate-600">
            An agent uploads a floor plan or a walkthrough video once. Renters walk through the apartment in 3D, check their furniture fits, meet compatible
            roommates whose AI clones talk first, split the rent fairly and apply as a group.
          </motion.p>
          <motion.ul {...rise(0.24)} className="mt-7 hidden flex-wrap gap-2 text-[13px] font-medium text-slate-600 sm:flex">
            {["3D from a floor plan", "Amenities from a video", "Furniture fit check", "AI roommate match", "Fair rent split", "One group application"].map((t) => (
              <li key={t} className="rounded-full bg-white/80 px-3 py-1.5 shadow-sm ring-1 ring-slate-200/90 backdrop-blur">{t}</li>
            ))}
          </motion.ul>
        </div>
        <motion.div {...(reduce ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } })}>
          <HeroIllustration />
        </motion.div>
      </header>

      {/* the two portals */}
      <section className="relative mx-auto max-w-6xl px-4 sm:px-6" aria-labelledby="portals">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">Two portals, one floor plan</p>
            <h2 id="portals" className="mt-1.5 text-3xl font-bold tracking-tight text-slate-900">Pick your side</h2>
          </div>
          <p className="max-w-sm text-sm text-slate-500">Renters and agents work from the same apartment, on either side of the lease.</p>
        </div>
        <div className="mt-6 grid gap-5 md:grid-cols-2 lg:gap-6">
          {PORTALS.map((p) => <PortalCard key={p.id} p={p} />)}
        </div>
      </section>

      {/* guided tour */}
      <section className="relative mx-auto max-w-6xl px-4 pt-6 sm:px-6 lg:pt-8">
        <TourBanner />
      </section>

      {/* utilities */}
      <div className="relative mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-6 pt-12 text-xs sm:px-6">
        <button type="button" onClick={() => { demo.reset(); setFresh(true); }}
          className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 font-medium text-slate-600 shadow-sm ring-1 ring-slate-200 transition-colors hover:text-slate-900 hover:ring-slate-300">
          <IconRefresh className="h-3.5 w-3.5" />
          Reset demo data
        </button>
        <span aria-live="polite" className={`text-emerald-600 transition-opacity ${fresh ? "opacity-100" : "opacity-0"}`}>{fresh ? "All fresh ✓" : ""}</span>
        <Link to="/dev" className="ml-auto font-medium text-slate-500 transition-colors hover:text-slate-900">Parser lab (under the hood) →</Link>
      </div>

      <footer className="relative border-t border-slate-200/80 bg-slate-50/60">
        <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-4 py-6 text-sm text-slate-500 sm:px-6">
          <FitSplitMark className="h-5 w-5" />
          <span>{PRODUCT} · Built by Tanvi Deshpande and Aatmaj Salunke</span>
        </div>
      </footer>
    </div>
  );
}
