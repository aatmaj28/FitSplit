import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cachedRentCheck, liveRentCheck, rentCheckKey, rentCheckRequest, type RentCheckResult } from "../rentCheck";
import type { SplitOptions, SplitResult } from "../rentSplit";

export type Suggestion = RentCheckResult["suggestions"][number];

type CheckState =
  | { status: "looking" }
  | { status: "found"; result: RentCheckResult }
  | { status: "unchecked" }
  | { status: "running" }
  | { status: "error"; message: string };

const CHECK_LABELS: Record<RentCheckResult["checks"][number]["id"], string> = {
  bedroom_count: "Bedroom count",
  private_bath: "Private baths",
  areas: "Room sizes",
  extras: "Other differences",
};
const PROVIDERS: Record<string, string> = { gemini: "Gemini", claude: "Claude", groq: "Groq" };

/** Looks the current inputs up in the caches (debounced); `run` asks the backend for a live check. */
export function useRentCheck(plan: string, split: SplitResult, opts: Pick<SplitOptions, "method" | "includeClosets">) {
  const req = useMemo(() => rentCheckRequest(plan, split, opts), [plan, split, opts.method, opts.includeClosets]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = useMemo(() => rentCheckKey(req), [req]);
  const [state, setState] = useState<CheckState>({ status: "looking" });
  const current = useRef(key);
  current.current = key;
  useEffect(() => {
    if (!req.rows.length || req.rent <= 0) return;
    setState({ status: "looking" });
    const t = setTimeout(async () => {
      const hit = await cachedRentCheck(req);
      if (current.current === key) setState(hit ? { status: "found", result: hit } : { status: "unchecked" });
    }, 350);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    setState({ status: "running" });
    try {
      const result = await liveRentCheck(req);
      if (current.current === key) setState({ status: "found", result });
    } catch (e) {
      if (current.current === key) setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [req, key]);
  return { state, run, key };
}

function Spinner() {
  return <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;
}

/** "AI checked ✓" pill for the rent split header; toggles the details. */
export function RentCheckBadge({ state, open, onToggle, onRun }: {
  state: CheckState;
  open: boolean;
  onToggle: () => void;
  onRun: () => void;
}) {
  const base = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors";
  if (state.status === "looking") return <span className={`${base} bg-slate-100 text-slate-500`}><Spinner /> AI check</span>;
  if (state.status === "running") return <span className={`${base} bg-slate-100 text-slate-600`}><Spinner /> Checking with AI…</span>;
  if (state.status === "unchecked" || state.status === "error") {
    return (
      <button type="button" onClick={onRun} title={state.status === "error" ? state.message : "Ask the AI to review these inputs against the floor plan"}
        className={`${base} bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50 hover:text-slate-900`}>
        {state.status === "error" ? "AI check unavailable · retry" : "Check with AI"}
      </button>
    );
  }
  const warns = state.result.checks.filter((c) => c.status === "warn").length + state.result.suggestions.length;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-controls="rent-check-details"
      className={`${base} ${state.result.verdict === "ok" ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100" : "bg-amber-50 text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"}`}>
      {state.result.verdict === "ok" ? "AI checked ✓" : `AI check: ${warns} to review`}
      <svg viewBox="0 0 20 20" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="currentColor" aria-hidden>
        <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
      </svg>
    </button>
  );
}

/** What the AI looked at, its warnings, suggested input fixes and the note for roommates. */
export function RentCheckDetails({ result, onApply }: { result: RentCheckResult; onApply: (s: Suggestion) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div id="rent-check-details" className="space-y-2.5 rounded-xl bg-slate-50 p-3 text-xs ring-1 ring-slate-200">
      <ul className="space-y-1.5">
        {result.checks.map((c) => (
          <li key={c.id} className="flex gap-2">
            <span className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${c.status === "pass" ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden>
              {c.status === "pass" ? "✓" : "!"}
            </span>
            <span className="text-slate-600">
              <span className="font-medium text-slate-800">{CHECK_LABELS[c.id]}</span>
              <span className="sr-only">{c.status === "pass" ? " (looks right)" : " (needs a look)"}</span>: {c.reason}
            </span>
          </li>
        ))}
      </ul>
      {result.suggestions.map((s) => (
        <div key={`${s.action}:${s.room_id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-2 ring-1 ring-amber-200">
          <span className="text-amber-900">
            <span className="font-medium">Suggestion: {s.label}.</span> {s.reason}
          </span>
          <button type="button" onClick={() => onApply(s)} className="rounded-full bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700">
            Apply suggestion
          </button>
        </div>
      ))}
      <div className="rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-200">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">For your roommates</span>
          <button type="button" className="text-[11px] font-medium text-teal-700 hover:text-teal-900"
            onClick={() => navigator.clipboard?.writeText(result.explanation).then(() => setCopied(true), () => {})}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-1 leading-relaxed text-slate-700">{result.explanation}</p>
      </div>
      <p className="text-[11px] text-slate-400">
        Checked by {PROVIDERS[result.provider] ?? result.provider} against the floor plan. The AI only reviews the inputs; every
        dollar amount is computed by code{result.explanation_source === "template" ? " (the note above is written by code too)" : ""}.
      </p>
    </div>
  );
}
