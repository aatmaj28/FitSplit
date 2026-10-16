import { useState } from "react";
import { useSearchParams } from "react-router";
import type { ParsedPlan } from "../types";
import { buildEngine, defaultEngine, ENGINES, type LayoutEngine, type MediaJob } from "./api";

/** The layout engine on show (kept in the URL as ?engine=, so a link opens the same plan). */
export function useLayoutEngine(job: MediaJob | null): [LayoutEngine, (e: LayoutEngine) => void] {
  const [params, setParams] = useSearchParams();
  const fallback = defaultEngine(job);
  const asked = params.get("engine") as LayoutEngine | null;
  const engine = asked && ENGINES.some((e) => e.id === asked) ? asked : fallback;
  const set = (e: LayoutEngine) => {
    const p = new URLSearchParams(params);
    if (e === fallback) p.delete("engine");
    else p.set("engine", e);
    setParams(p, { replace: true });
  };
  return [engine, set];
}

export function hasEngine(job: MediaJob, e: LayoutEngine): boolean {
  return Boolean(job.plans?.[e]) || (e === defaultEngine(job) && Boolean(job.plan));
}

/**
 * Combined | Tanvi's | FitSplit. An engine this listing doesn't have yet is built on request
 * (online; about a minute, a few model calls once); `onAsked` lets the page poll for it.
 */
export function LayoutEngineSwitch({ job, engine, onChange, onAsked, className = "" }: {
  job: MediaJob; engine: LayoutEngine; onChange: (e: LayoutEngine) => void; onAsked?: () => void; className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const pick = async (e: LayoutEngine) => {
    setError(null);
    onChange(e);
    if (hasEngine(job, e) || job.offline || job.engine_status?.[e] === "running") return;
    try {
      await buildEngine(job.id, e);
      onAsked?.();
    } catch (x) {
      setError((x as Error).message);
    }
  };
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} data-engine-switch>
      <span className="text-xs font-medium text-slate-500">Layout engine</span>
      <div role="group" aria-label="Layout engine" className="inline-flex rounded-full bg-slate-100 p-0.5 text-xs">
        {ENGINES.map(({ id, label }) => {
          const have = hasEngine(job, id);
          return (
            <button key={id} type="button" aria-pressed={engine === id} data-engine={id} onClick={() => pick(id)}
              disabled={job.offline === true && !have}
              title={have ? undefined : job.offline ? "Not built for this listing" : "Builds this engine's plan now (about a minute)"}
              className={`rounded-full px-3 py-1 font-medium transition-colors disabled:opacity-40 ${engine === id ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"}`}>
              {label}{id === job.layout_engine ? <span className="ml-1 text-[10px] text-slate-400">default</span> : null}
            </button>
          );
        })}
      </div>
      {error && <span className="text-xs text-rose-700">{error}</span>}
    </div>
  );
}

/** Shown in place of the plan while another engine is being built (or if building it failed). */
export function EngineBuilding({ job, engine }: { job: MediaJob; engine: LayoutEngine }) {
  const status = job.engine_status?.[engine];
  const label = ENGINES.find((e) => e.id === engine)?.label ?? engine;
  if (status?.startsWith("error")) {
    return <div className="grid h-[40vh] min-h-[280px] place-items-center rounded-2xl bg-rose-50 p-6 text-sm text-rose-800 ring-1 ring-rose-200">Couldn't build the {label} layout: {status.slice(7)}</div>;
  }
  return (
    <div className="grid h-[40vh] min-h-[280px] place-items-center rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200" data-engine-building={engine}>
      {job.offline ? `The ${label} layout isn't available offline for this listing.` : `Laying out with the ${label} engine… about a minute; it's kept once built.`}
    </div>
  );
}

/** "Layout engine by …" under a floor plan from photos. */
export function EngineCredit({ plan, className = "" }: { plan: ParsedPlan & { credit?: string; notes?: string }; className?: string }) {
  if (!plan.credit) return null;
  return (
    <p className={`text-xs text-slate-500 ${className}`} data-engine-credit>
      {plan.credit}
      {plan.layout_engine === "tanvi" || plan.layout_engine === "combined" ? (
        <> · <a href="https://github.com/Tanvi-15/Layout-maker" target="_blank" rel="noreferrer" className="underline decoration-slate-300 hover:text-slate-800">Tanvi's layout maker</a></>
      ) : null}
    </p>
  );
}
