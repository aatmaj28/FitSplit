import { motion, useReducedMotion, type Variants } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PRODUCT } from "../../brand";
import { demo } from "../../data/store";
import { Faces } from "../landing/cast";
import { FitSplitMark, IconCube, IconHeart, IconInbox, IconPlay, IconSplit, IconUpload, IconUsers } from "../landing/icons";
import { LeaseHubMark, RoombaeMark } from "../portals";
import { setDemoActive, setDemoStep, STEPS } from "./steps";

const SIDE = {
  LeaseHub: {
    color: "#2563eb",
    label: "text-blue-700",
    node: "bg-blue-50 text-blue-600 ring-blue-100",
    card: "hover:ring-blue-300 hover:shadow-[0_22px_44px_-28px_rgba(37,99,235,0.6)]",
    Mark: LeaseHubMark,
  },
  Roombae: {
    color: "#e8553e",
    label: "text-[#d4452f]",
    node: "bg-[#fff1ec] text-[#e8553e] ring-[#f8d3c8]",
    card: "hover:ring-[#f0a796] hover:shadow-[0_22px_44px_-28px_rgba(232,85,62,0.6)]",
    Mark: RoombaeMark,
  },
} as const;

const ICONS: Record<number, ReactNode> = {
  1: <IconUpload />,
  2: <IconHeart />,
  3: <IconCube />,
  4: <IconSplit />,
  5: <IconUsers />,
  6: <IconInbox />,
};

const OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
const list: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } } };
const item: Variants = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: OUT } } };
const line: Variants = { hidden: { scaleY: 0 }, show: { scaleY: 1, transition: { delay: 0.25, duration: 0.5, ease: "easeOut" } } };

/** The cast of the tour: both portals and the three renters. */
function WhosWho({ className }: { className: string }) {
  return (
    <div className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${className}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Who's who</p>
      <ul className="mt-3 space-y-2.5 text-sm text-slate-600">
        <li className="flex items-center gap-2.5"><LeaseHubMark className="h-7 w-7 shrink-0" /><span><span className="font-semibold text-slate-900">LeaseHub</span> · the agent's portal</span></li>
        <li className="flex items-center gap-2.5"><RoombaeMark className="h-7 w-7 shrink-0" /><span><span className="font-semibold text-slate-900">Roombae</span> · the renters' portal</span></li>
        <li className="flex items-center gap-2.5">
          <Faces className="h-7 w-7" />
          <span><span className="font-semibold text-slate-900">Priya, Ananya and Meera</span> · the renters</span>
        </li>
      </ul>
    </div>
  );
}

/** /demo: the walkthrough's start page; /demo/:step jumps straight into a step. */
export default function Demo() {
  const { step } = useParams();
  const navigate = useNavigate();
  const reduce = useReducedMotion() ?? false;
  useEffect(() => {
    const n = Number(step);
    if (n >= 1 && n <= STEPS.length) {
      setDemoActive(true);
      setDemoStep(n - 1);
      navigate(STEPS[n - 1].path(), { replace: true });
    }
  }, [step, navigate]);
  const start = () => {
    demo.reset();
    setDemoActive(true);
    setDemoStep(0);
    navigate(STEPS[0].path());
  };
  return (
    <div className="relative min-h-full overflow-x-clip bg-slate-50 text-slate-900">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
        style={{ background: "radial-gradient(40rem 24rem at 10% -10%, rgba(45,212,191,0.16), transparent 70%), radial-gradient(34rem 22rem at 90% 0%, rgba(232,85,62,0.07), transparent 70%)" }} />
      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14 lg:py-16">
        <motion.aside className="lg:sticky lg:top-12 lg:self-start"
          initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: OUT }}>
          <Link to="/" className="inline-flex items-center gap-2 rounded-full bg-white py-1 pl-1.5 pr-3 text-sm font-medium text-slate-600 shadow-sm ring-1 ring-slate-200 transition-colors hover:text-slate-900 hover:ring-slate-300">
            <span aria-hidden className="text-slate-400">←</span>
            <FitSplitMark className="h-5 w-5" />
            {PRODUCT} home
          </Link>
          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">Guided tour · about 3 minutes</p>
          <h1 className="mt-2 text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">One unit, two portals, six steps</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-600 sm:text-base">
            An agent posts a JVUE 3 bed on LeaseHub. Three students find each other on Roombae, check that their furniture fits, split the
            rent fairly and apply together. The agent gets one complete application.
          </p>
          <button type="button" onClick={start}
            className="group mt-7 inline-flex items-center gap-3 rounded-full bg-teal-600 py-2.5 pl-2.5 pr-6 text-base font-semibold text-white shadow-lg shadow-teal-700/25 transition hover:-translate-y-0.5 hover:bg-teal-700 hover:shadow-xl hover:shadow-teal-700/25 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/30">
            <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-white/20 transition-transform group-hover:scale-105">
              <IconPlay className="ml-0.5 h-4 w-4" />
            </span>
            Reset and start the demo
          </button>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">Starts fresh at step 1. Move along with the step bar at the bottom of the screen, or PageDown and PageUp.</p>

          <WhosWho className="mt-8 hidden lg:block" />
        </motion.aside>

        <motion.ol className="relative mt-10 lg:mt-1" aria-label="Tour steps" variants={list} initial={reduce ? false : "hidden"} animate="show">
          {STEPS.map((s, i) => {
            const c = SIDE[s.side];
            const next = STEPS[i + 1];
            return (
              <motion.li key={s.n} variants={item} className="relative pb-4 pl-16 last:pb-0 sm:pl-[72px]">
                {next && (
                  <motion.span aria-hidden variants={line} className="absolute -bottom-1 left-[23px] top-[60px] w-[2px] origin-top rounded-full opacity-40"
                    style={{ background: `linear-gradient(${c.color}, ${SIDE[next.side].color})` }} />
                )}
                <span aria-hidden className={`absolute left-0 top-2 grid h-12 w-12 place-items-center rounded-2xl shadow-sm ring-1 ${c.node}`}>
                  {ICONS[s.n]}
                  <span className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white ring-2 ring-slate-50" style={{ background: c.color }}>
                    {s.n}
                  </span>
                </span>
                <button type="button" onClick={() => { setDemoActive(true); setDemoStep(s.n - 1); navigate(s.path()); }}
                  className={`group w-full rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 sm:px-5 ${c.card}`}>
                  <span className="flex items-center justify-between gap-3">
                    <span className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${c.label}`}>
                      <c.Mark className="h-3.5 w-3.5" /> Step {s.n} · {s.side}
                    </span>
                    <span aria-hidden className="text-slate-300 transition duration-200 group-hover:translate-x-0.5 group-hover:text-slate-500">→</span>
                  </span>
                  <span className="mt-1 block text-[17px] font-semibold tracking-tight text-slate-900">{s.title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-slate-600">{s.hint}</span>
                </button>
              </motion.li>
            );
          })}
        </motion.ol>
        <WhosWho className="mt-8 lg:hidden" />
      </div>
    </div>
  );
}
