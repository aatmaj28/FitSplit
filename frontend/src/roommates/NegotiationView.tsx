import { useEffect, useMemo, useRef, useState } from "react";
import { parseAcp, type Part } from "./acp";
import type { Analysis, Check, NegotiationEvent, NegotiationMessage, Outcome, Verdict } from "./api";

const PHASES = [
  { id: "introduction", label: "Introduction" },
  { id: "exploration", label: "Lifestyle" },
  { id: "negotiation", label: "Negotiation" },
  { id: "conclusion", label: "Conclusion" },
] as const;

export const VERDICT_STYLE: Record<Verdict, { label: string; cls: string }> = {
  strong: { label: "Strong match", cls: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
  conditional: { label: "Conditional match", cls: "bg-amber-100 text-amber-800 ring-amber-200" },
  incompatible: { label: "Incompatible", cls: "bg-rose-100 text-rose-800 ring-rose-200" },
};

export function VerdictBadge({ status, className = "" }: { status: Verdict; className?: string }) {
  const v = VERDICT_STYLE[status];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${v.cls} ${className}`}>{v.label}</span>;
}

export function ScoreBars({ scores }: { scores: Analysis["scores"] }) {
  const rows: [keyof Analysis["scores"], string][] = [["finances", "Finances"], ["lifestyle", "Lifestyle"], ["personality", "Personality"], ["logistics", "Logistics"]];
  return (
    <div className="space-y-1.5">
      {rows.map(([k, label]) => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0 text-slate-500">{label}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
            <span className="block h-full rounded-full bg-gradient-to-r from-violet-400 to-violet-600 transition-[width] duration-700" style={{ width: `${scores[k]}%` }} />
          </span>
          <span className="w-7 text-right tabular-nums text-slate-700">{scores[k]}</span>
        </div>
      ))}
    </div>
  );
}

export function Avatar({ name, color, size = 8 }: { name: string; color: string; size?: number }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: color, width: size * 4, height: size * 4 }} aria-hidden>
      {initials}
    </span>
  );
}

const PART_STYLE: Record<string, string> = {
  HI: "bg-sky-50 text-sky-800 ring-sky-200",
  PFR: "bg-slate-50 text-slate-700 ring-slate-200",
  CNF: "bg-amber-50 text-amber-800 ring-amber-200",
  FLX: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  VRD: "bg-violet-50 text-violet-800 ring-violet-200",
};

function PartView({ part }: { part: Part }) {
  if (part.kind === "text") return <p className="leading-relaxed">{part.text}</p>;
  return (
    <div className={`rounded-lg px-2 py-1.5 ring-1 ${PART_STYLE[part.type]}`}>
      <span className="mr-1.5 text-[10px] font-bold uppercase tracking-wide opacity-70">{part.label}</span>
      {part.value && <span className="mr-1.5 font-medium">{part.value}</span>}
      {part.fields.map((f, i) => (
        <span key={i} className="mr-1.5 inline-block">
          {f.label && <span className="opacity-60">{f.label} </span>}
          <span className="font-medium">{f.value}</span>
          {i < part.fields.length - 1 && <span className="opacity-30"> ·</span>}
        </span>
      ))}
    </div>
  );
}

function Bubble({ msg, side, color, shownParts, raw }: { msg: NegotiationMessage; side: "left" | "right"; color: string; shownParts: number; raw: boolean }) {
  const { parts, modules } = useMemo(() => parseAcp(msg.message), [msg.message]);
  return (
    <div className={`flex items-end gap-2 ${side === "right" ? "flex-row-reverse" : ""}`}>
      <Avatar name={msg.speaker} color={color} />
      <div className={`max-w-[85%] space-y-1.5 rounded-2xl px-3 py-2 text-[13px] shadow-sm ring-1 ring-slate-200 ${side === "left" ? "rounded-bl-md bg-white" : "rounded-br-md bg-violet-50/60"}`}>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="font-semibold text-slate-600">{msg.speaker}'s clone</span>
          <span>turn {msg.turn}</span>
          {modules.map((m) => (
            <span key={m} className="rounded-full bg-slate-100 px-1.5 py-px text-[10px] text-slate-500" title="The clone asked for more of its profile">
              + {m.toLowerCase()} profile
            </span>
          ))}
        </div>
        {raw ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-slate-600">{msg.message}</pre>
        ) : (
          parts.slice(0, Math.max(1, shownParts)).map((p, i) => <PartView key={i} part={p} />)
        )}
      </div>
    </div>
  );
}

function Typing({ name, color, side }: { name: string; color: string; side: "left" | "right" }) {
  return (
    <div className={`flex items-end gap-2 ${side === "right" ? "flex-row-reverse" : ""}`}>
      <Avatar name={name} color={color} />
      <div className="rounded-2xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-200" aria-label={`${name}'s clone is typing`}>
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </span>
      </div>
    </div>
  );
}

export function ChecksList({ checks }: { checks: Check[] }) {
  if (!checks.length) return null;
  const label: Record<Check["id"], string> = { budget: "Budget", gender: "Roommate gender", furniture: "Furniture", bathroom: "Bathroom" };
  return (
    <ul className="space-y-1 text-xs">
      {checks.map((c) => (
        <li key={c.id} className="flex gap-2">
          <span className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${c.ok ? "bg-emerald-500" : c.hard ? "bg-rose-500" : "bg-amber-500"}`} aria-hidden>
            {c.ok ? "✓" : "!"}
          </span>
          <span className="text-slate-600"><span className="font-medium text-slate-800">{label[c.id]}:</span> {c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export function ResultCard({ result, analysis, checks }: { result: Outcome; analysis: Analysis | null; checks: Check[] }) {
  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" data-verdict={result.status}>
      <div className="flex flex-wrap items-center gap-2">
        <VerdictBadge status={result.status} className="text-sm" />
        {analysis && <span className="text-sm text-slate-500">Compatibility <span className="font-semibold text-slate-900">{analysis.scores.overall}</span>/100</span>}
      </div>
      {result.reason && <p className="text-sm text-slate-700">{result.reason}</p>}
      {result.unresolved_topics.length > 0 && result.status !== "incompatible" && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="text-slate-500">Still to agree on:</span>
          {result.unresolved_topics.map((t) => <span key={t} className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800 ring-1 ring-amber-200">{t}</span>)}
        </div>
      )}
      {checks.length > 0 && <ChecksList checks={checks} />}
      {analysis && (
        <>
          <ScoreBars scores={analysis.scores} />
          {analysis.recommendation_summary && <p className="text-sm leading-relaxed text-slate-600">{analysis.recommendation_summary}</p>}
          <div className="grid gap-3 text-xs sm:grid-cols-3">
            {[["Works well", analysis.highlights], ["Watch out for", analysis.concerns], ["Middle ground", analysis.middle_ground]].map(([title, items]) =>
              (items as string[]).length ? (
                <div key={title as string}>
                  <div className="mb-1 font-semibold text-slate-700">{title as string}</div>
                  <ul className="list-disc space-y-0.5 pl-4 text-slate-600">{(items as string[]).slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              ) : null,
            )}
          </div>
        </>
      )}
      {result.source === "exact_check" && <p className="text-xs text-slate-400">Decided by an exact check before the clones talked, so no AI call was needed.</p>}
    </div>
  );
}

/**
 * The clones' conversation. With `animate`, events play back like a live chat (typing dots, then
 * the message statement by statement); live SSE events simply keep extending `events`.
 */
export function NegotiationView({ events, animate = true, a, b, onDone, showChecks = true }: {
  events: NegotiationEvent[];
  animate?: boolean;
  a: { name: string; color: string };
  b: { name: string; color: string };
  onDone?: () => void;
  /** off when the page shows the exact checks itself */
  showChecks?: boolean;
}) {
  const [speed, setSpeed] = useState(1);
  const [raw, setRaw] = useState(false);
  const [pos, setPos] = useState(animate ? 0 : events.length); // events fully shown
  const [step, setStep] = useState(0); // 0 = typing dots, n = parts of events[pos] shown
  const end = useRef<HTMLDivElement>(null);
  const skip = () => {
    setPos(events.length);
    setStep(0);
  };
  useEffect(() => {
    if (!animate) setPos(events.length);
  }, [animate, events.length]);

  useEffect(() => {
    if (pos >= events.length) return;
    const e = events[pos];
    const next = () => {
      setPos((p) => p + 1);
      setStep(0);
    };
    if (e.type !== "agent_message") {
      const t = setTimeout(next, (e.type === "phase_start" ? 450 : 250) / speed);
      return () => clearTimeout(t);
    }
    const n = parseAcp(e.data.message).parts.length || 1;
    const t = setTimeout(step >= n ? next : () => setStep((s) => s + 1), (step === 0 ? 650 : step >= n ? 350 : 260) / speed);
    return () => clearTimeout(t);
  }, [pos, step, events, speed]);

  const done = pos >= events.length && events.some((e) => e.type === "complete");
  useEffect(() => {
    if (done) onDone?.();
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); // returns a Promise in newer browsers: not a cleanup
  }, [pos, step]);

  const shown = events.slice(0, pos);
  const current = pos < events.length ? events[pos] : null;
  const phase = [...shown].reverse().find((e) => e.type === "phase_start") as Extract<NegotiationEvent, { type: "phase_start" }> | undefined;
  const complete = shown.find((e) => e.type === "complete") as Extract<NegotiationEvent, { type: "complete" }> | undefined;
  const checks = shown.find((e) => e.type === "checks") as Extract<NegotiationEvent, { type: "checks" }> | undefined;
  const side = (m: NegotiationMessage) => (m.speaker_id === "a" ? "left" : "right");
  const color = (m: NegotiationMessage) => (m.speaker_id === "a" ? a.color : b.color);
  const phaseIdx = complete ? PHASES.length : PHASES.findIndex((p) => p.id === phase?.phase);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ol className="flex flex-wrap gap-1 text-[11px]" aria-label="Negotiation phases">
          {PHASES.map((p, i) => (
            <li key={p.id} className={`rounded-full px-2 py-0.5 font-medium ${i < phaseIdx ? "bg-violet-100 text-violet-700" : i === phaseIdx ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-400"}`}>
              {i + 1} {p.label}
            </li>
          ))}
        </ol>
        <div className="flex items-center gap-1.5 text-[11px]">
          <button type="button" onClick={() => setRaw((r) => !r)} aria-pressed={raw} className="rounded-full px-2 py-0.5 text-slate-500 ring-1 ring-slate-200 hover:text-slate-800">
            {raw ? "Readable" : "Raw ACP"}
          </button>
          {!done && (
            <>
              <button type="button" onClick={() => setSpeed((s) => (s >= 4 ? 1 : s * 2))} className="rounded-full px-2 py-0.5 text-slate-500 ring-1 ring-slate-200 hover:text-slate-800">
                {speed}×
              </button>
              <button type="button" onClick={skip} className="rounded-full px-2 py-0.5 text-slate-500 ring-1 ring-slate-200 hover:text-slate-800">
                Skip to result
              </button>
            </>
          )}
        </div>
      </div>

      {showChecks && checks && checks.checks.length > 0 && (
        <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Exact checks</div>
          <ChecksList checks={checks.checks} />
        </div>
      )}

      <div className="flex flex-col gap-3" aria-live="polite">
        {shown.map((e, i) =>
          e.type === "phase_start" ? (
            <div key={i} className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              {e.label}
              <span className="h-px flex-1 bg-slate-200" />
            </div>
          ) : e.type === "agent_message" ? (
            <Bubble key={i} msg={e.data} side={side(e.data)} color={color(e.data)} shownParts={99} raw={raw} />
          ) : e.type === "error" ? (
            <p key={i} className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{e.message}</p>
          ) : null,
        )}
        {current?.type === "agent_message" &&
          (step === 0 ? (
            <Typing name={current.data.speaker} color={color(current.data)} side={side(current.data)} />
          ) : (
            <Bubble msg={current.data} side={side(current.data)} color={color(current.data)} shownParts={step} raw={raw} />
          ))}
        {(current?.type === "analyzing" || (shown.some((e) => e.type === "analyzing") && !complete && !current)) && (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-300 border-t-violet-600" aria-hidden /> Scoring the conversation…
          </p>
        )}
        {complete && <ResultCard result={complete.result} analysis={complete.analysis} checks={[]} />}
        <div ref={end} />
      </div>
    </div>
  );
}
