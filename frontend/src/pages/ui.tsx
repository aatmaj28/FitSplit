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

export function SampleBadge({ children = "Sample data" }: { children?: ReactNode }) {
  return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">{children}</span>;
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
