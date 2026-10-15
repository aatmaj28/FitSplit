import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PRODUCT } from "../../brand";
import { demo } from "../../data/store";
import { setDemoActive, STEPS } from "./steps";

/** /demo: the walkthrough's start page; /demo/:step jumps straight into a step. */
export default function Demo() {
  const { step } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    const n = Number(step);
    if (n >= 1 && n <= STEPS.length) {
      setDemoActive(true);
      navigate(STEPS[n - 1].path(), { replace: true });
    }
  }, [step, navigate]);
  const start = () => {
    demo.reset();
    setDemoActive(true);
    navigate(STEPS[0].path());
  };
  return (
    <div className="min-h-full bg-slate-900 text-white">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Link to="/" className="text-sm text-teal-300 hover:text-teal-200">← {PRODUCT}</Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">One unit, two portals, six steps</h1>
        <p className="mt-2 text-slate-300">An agent posts a JVUE 3 bed on LeaseHub. Three students find each other on Roombae, check that their furniture fits, split the rent fairly and apply together. The agent gets one complete application.</p>
        <ol className="mt-8 space-y-2">
          {STEPS.map((s) => (
            <li key={s.n}>
              <button type="button" onClick={() => { setDemoActive(true); navigate(s.path()); }} className="flex w-full items-start gap-3 rounded-xl bg-white/5 px-4 py-3 text-left ring-1 ring-white/10 transition hover:bg-white/10">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-teal-400 text-sm font-bold text-slate-900">{s.n}</span>
                <span>
                  <span className="block font-semibold"><span className="text-teal-300">{s.side}</span> · {s.title}</span>
                  <span className="block text-sm text-slate-400">{s.hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button type="button" onClick={start} className="rounded-full bg-teal-400 px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-teal-300">Reset and start the demo</button>
          <span className="text-xs text-slate-400">Works offline: plans, AI checks and clone conversations are bundled. Shift + arrows move between steps.</span>
        </div>
      </div>
    </div>
  );
}
