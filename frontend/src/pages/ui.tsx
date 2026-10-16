import type { ReactNode } from "react";
import { PRODUCT } from "../brand";

/** Shared building blocks for the portal pages (loading / empty / error states, badges, buttons). */

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden />;
}

export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-slate-400" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
      <div className="text-sm font-semibold text-slate-700">{title}</div>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", children, onRetry }: { title?: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200" role="alert">
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-0.5 text-rose-700">{children}</div>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-rose-800 ring-1 ring-rose-200 hover:bg-rose-100">
          Try again
        </button>
      )}
    </div>
  );
}


export function PoweredBy({ dark = false }: { dark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${dark ? "text-slate-300" : "text-slate-400"}`}>
      <span className="grid h-4 w-4 place-items-center rounded bg-teal-600 text-[9px] font-bold text-white" aria-hidden>F</span>
      Powered by <span className={`font-semibold ${dark ? "text-white" : "text-slate-600"}`}>{PRODUCT}</span>
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-base font-semibold text-slate-900">{value}</div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

// button styles shared by both portals (each portal tints its primary color)
export const btn = {
  base: "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  ghost: "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50",
};

/** Small pill tabs above a listing's main view (3D / Walkthrough / Photos); hidden with one tab. */
export function ViewTabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string }[] }) {
  if (tabs.length < 2) return null;
  return (
    <div role="tablist" aria-label="View" className="inline-flex gap-1 rounded-full bg-slate-100 p-1">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} data-view-tab={t.id}
          className={`rounded-full px-3.5 py-1 text-sm font-medium transition-colors ${value === t.id ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
