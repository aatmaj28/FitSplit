import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { demo } from "../../data/store";
import { demoActive, demoStep, setDemoActive, setDemoStep, STEPS } from "./steps";

/** Floating step bar for the guided demo (shown inside both portals while demo mode is on). */
export function DemoBar() {
  const { pathname, hash, search } = useLocation();
  const navigate = useNavigate();
  const [on, setOn] = useState(demoActive);
  useEffect(() => {
    if (new URLSearchParams(search).get("demo") === "1") {
      setDemoActive(true);
      setOn(true);
    }
  }, [search]);
  // follow the page: a step's own page sets the step; any other page keeps the last one
  const matched = STEPS.findIndex((s) => s.matches(pathname, hash));
  const [last, setLast] = useState(demoStep);
  useEffect(() => {
    if (matched >= 0) {
      setLast(matched);
      setDemoStep(matched);
    }
  }, [matched]);
  const idx = matched >= 0 ? matched : last;
  const off = matched < 0; // on a page that isn't the current step's
  const go = (i: number) => {
    const n = Math.min(STEPS.length - 1, Math.max(0, i));
    const step = STEPS[n];
    setLast(n);
    setDemoStep(n);
    navigate(step.path());
    if (step.path().includes("#rent")) setTimeout(() => document.getElementById("rent-split")?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
    else window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      // Shift + arrows nudge a selected furniture piece by 1 ft; then they're not demo keys (Page Up / Down still are)
      if (e.shiftKey && e.key.startsWith("Arrow") && document.querySelector('[data-editing="true"][data-item-selected="true"]')) return;
      if (e.key === "PageDown" || (e.key === "ArrowRight" && e.shiftKey)) go(idx + 1);
      else if (e.key === "PageUp" || (e.key === "ArrowLeft" && e.shiftKey)) go(idx - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, idx]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!on) return;
    // lets sticky page controls (the chat's "Jump to latest") sit above the floating bar
    document.documentElement.style.setProperty("--demo-bar-h", "6.5rem");
    return () => {
      document.documentElement.style.removeProperty("--demo-bar-h");
    };
  }, [on]);
  if (!on) return null;
  const step = STEPS[idx];
  return (
    <>
    <div className="h-32" aria-hidden />
    <div className="fixed inset-x-2 bottom-2 z-[60] mx-auto max-w-4xl rounded-2xl bg-slate-900/95 p-3 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur sm:inset-x-4 sm:bottom-4" role="region" aria-label="Demo walkthrough" data-demo-step={step.n}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ol className="flex gap-1" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.n}>
              <button type="button" onClick={() => go(i)} aria-current={i === idx ? "step" : undefined} title={`${s.n}. ${s.title}`}
                className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold transition-colors ${i === idx ? "bg-teal-400 text-slate-900" : i < idx ? "bg-teal-700 text-white" : "bg-white/10 text-slate-300 hover:bg-white/20"}`}>
                {s.n}
              </button>
            </li>
          ))}
        </ol>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold"><span className="text-teal-300">{step.side}</span> · {step.title}</div>
          <div className="text-xs text-slate-300">{step.hint}</div>
          {off && (
            <button type="button" onClick={() => go(idx)} className="mt-0.5 text-[11px] font-medium text-teal-300 hover:text-teal-200" data-demo-return>
              You're off this step's page · back to step {step.n} ↩
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => go(idx - 1)} disabled={idx === 0} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20 disabled:opacity-40">← Back</button>
          <button type="button" onClick={() => go(idx + 1)} disabled={idx === STEPS.length - 1} className="rounded-full bg-teal-400 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-teal-300 disabled:opacity-40">Next →</button>
          <button type="button" onClick={() => { demo.reset(); go(0); }} className="rounded-full px-2 py-1.5 text-xs text-slate-300 hover:text-white" title="Start the demo over">Reset demo</button>
          <button type="button" onClick={() => { setDemoActive(false); setOn(false); }} className="rounded-full px-2 py-1.5 text-xs text-slate-400 hover:text-white" aria-label="Exit demo">✕</button>
        </div>
      </div>
      <div className="mt-1 hidden text-[10px] text-slate-500 sm:block">Shift + → / Shift + ← or Page Down / Page Up to move between steps</div>
    </div>
    </>
  );
}
