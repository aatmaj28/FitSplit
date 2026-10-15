import type { Profile, Questionnaire, QuestionnaireSchema, QuestionSpec } from "./api";
import { budgetOf } from "./fit";

/** The 7-section questionnaire from the roommate engine (schema served by the backend / bundled). */
export function QuestionnaireForm({ schema, value, onChange }: {
  schema: QuestionnaireSchema;
  value: Questionnaire;
  onChange: (q: Questionnaire) => void;
}) {
  const set = (section: string, key: string, v: unknown) => onChange({ ...value, [section]: { ...(value[section] ?? {}), [key]: v } });
  return (
    <div className="space-y-2">
      {Object.entries(schema.questions).map(([section, fields], i) => (
        <details key={section} open={i === 0} className="group rounded-xl bg-white ring-1 ring-slate-200">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-semibold text-slate-800">
            {schema.sections[section]?.replace(/^\W+\s*/, "") ?? section}
            <span className="text-xs font-normal text-slate-400 group-open:hidden">{Object.keys(fields).length} questions</span>
          </summary>
          <div className="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-2">
            {Object.entries(fields).map(([key, spec]) => (
              <Field key={key} id={`${section}.${key}`} spec={spec} value={value[section]?.[key]} onChange={(v) => set(section, key, v)} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function Field({ id, spec, value, onChange }: { id: string; spec: QuestionSpec; value: unknown; onChange: (v: unknown) => void }) {
  const options = Array.isArray(spec.options) ? spec.options : [];
  const label = (
    <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
      {spec.question}
      {spec.required && <span className="text-rose-500"> *</span>}
    </label>
  );
  const input = "w-full rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm text-slate-800 ring-1 ring-slate-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-400";
  if (spec.type === "multiselect") {
    const picked = Array.isArray(value) ? (value as string[]) : [];
    const full = spec.max_select != null && picked.length >= spec.max_select;
    return (
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-xs font-medium text-slate-600">
          {spec.question}
          {spec.max_select && <span className="text-slate-400"> (up to {spec.max_select})</span>}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => {
            const on = picked.includes(o);
            return (
              <button key={o} type="button" aria-pressed={on} disabled={!on && full} onClick={() => onChange(on ? picked.filter((x) => x !== o) : [...picked, o])}
                className={`rounded-full px-2.5 py-1 text-xs ring-1 transition-colors disabled:opacity-40 ${on ? "bg-violet-600 text-white ring-violet-600" : "bg-white text-slate-600 ring-slate-200 hover:text-slate-900"}`}>
                {o}
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }
  if (spec.type === "select") {
    return (
      <div>
        {label}
        <select id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={input}>
          {!options.includes(String(value ?? "")) && <option value="">Choose…</option>}
          {options.map((o) => <option key={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  if (spec.type === "slider") {
    return (
      <div>
        {label}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">{spec.labels?.[0] ?? spec.min}</span>
          <input id={id} type="range" min={spec.min} max={spec.max} value={Number(value ?? spec.default ?? 3)} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-violet-600" />
          <span className="text-[11px] text-slate-400">{spec.labels?.[1] ?? spec.max}</span>
          <span className="w-4 text-right text-sm font-semibold tabular-nums">{String(value ?? spec.default)}</span>
        </div>
      </div>
    );
  }
  if (spec.type === "number") {
    return (
      <div>
        {label}
        <input id={id} type="number" min={spec.min} max={spec.max} value={Number(value ?? spec.default ?? 0)} onChange={(e) => onChange(Number(e.target.value))} className={input} />
      </div>
    );
  }
  return (
    <div className="sm:col-span-2">
      {label}
      <input id={id} value={String(value ?? "")} placeholder={spec.placeholder} onChange={(e) => onChange(e.target.value)} className={input} />
    </div>
  );
}

/** The few answers that matter most, as chips. */
export function ProfileFacts({ p }: { p: Profile }) {
  const q = p.questionnaire as Record<string, Record<string, unknown>>;
  const b = budgetOf(p);
  const facts = [
    `$${b.min.toLocaleString()}–$${b.max.toLocaleString()}/mo${b.flex ? ` (+$${b.flex} flex)` : " (hard cap)"}`,
    String(q.routines?.sleep_schedule ?? "").replace(/ \(.*\)/, ""),
    `Cleanliness ${q.routines?.cleanliness}/5`,
    String(q.social?.overnight_guests ?? "").replace(/ \(.*\)/, "") + " guests",
    String(q.living?.smoking ?? ""),
  ].filter(Boolean);
  const nn = (q.dealbreakers?.non_negotiables as string[] | undefined) ?? [];
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {facts.map((f) => <span key={f} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{f}</span>)}
      </div>
      {nn.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {nn.map((f) => <span key={f} className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700 ring-1 ring-rose-200">Won't budge: {f}</span>)}
        </div>
      )}
    </div>
  );
}
