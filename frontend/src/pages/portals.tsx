import { Link } from "react-router";
import { PRODUCT } from "../brand";

export type Portal = "roombae" | "leasehub";

/** Original simple marks for the mock portals (not Roombae's or LeaseHub's real logos). */
export function RoombaeMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#e8553e" />
      <circle cx="12.5" cy="13" r="4" fill="#fff" />
      <circle cx="20.5" cy="13" r="4" fill="#ffd9cf" />
      <path d="M6.5 25c1-4 3.7-6 6-6s5 2 6 6M14 25c1-4 3.7-6 6.5-6s5 2 6 6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function LeaseHubMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#2563eb" />
      <path d="M8 24V13l8-5 8 5v11" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="16" cy="17.5" r="2.6" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M16 20v4" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ProductMark({ className = "h-4 w-4 text-[9px]" }: { className?: string }) {
  return <span className={`grid place-items-center rounded bg-teal-500 font-bold text-white ${className}`} aria-hidden>F</span>;
}

const PORTALS: { id: Portal; name: string; who: string; to: string; Mark: typeof RoombaeMark }[] = [
  { id: "roombae", name: "Roombae", who: "renter", to: "/roombae", Mark: RoombaeMark },
  { id: "leasehub", name: "LeaseHub", who: "agent", to: "/leasehub", Mark: LeaseHubMark },
];

/** Slim bar above both mock portals: back to the FitSplit home page, and a switch between the portals. */
export function PortalBar({ current, wide = false }: { current: Portal; wide?: boolean }) {
  return (
    <div className="border-b border-white/10 bg-slate-950 text-xs text-slate-300" data-portal-bar={current}>
      <div className={`flex items-center justify-between gap-3 px-4 py-1.5 ${wide ? "" : "mx-auto max-w-6xl"}`}>
        <Link to="/" className="flex items-center gap-1.5 rounded-full py-0.5 pr-2 font-medium hover:text-white">
          <ProductMark />
          <span><span className="sr-only">{PRODUCT} </span>Home</span>
        </Link>
        <nav className="inline-flex items-center gap-0.5 rounded-full bg-white/10 p-0.5" aria-label="Switch portal">
          {PORTALS.map(({ id, name, who, to, Mark }) => (
            <Link key={id} to={to} aria-current={id === current ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 transition-colors ${id === current ? "bg-white font-semibold text-slate-900" : "text-slate-300 hover:text-white"}`}>
              <Mark className="h-3.5 w-3.5" />
              {name}
              <span className="hidden text-slate-500 sm:inline">({who})</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
