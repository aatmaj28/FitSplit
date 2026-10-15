import { Suspense } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { useDemo } from "../../data/store";
import { DemoBar } from "../demo/DemoBar";
import { LeaseHubMark, PortalBar } from "../portals";
import { PageLoading, PoweredBy, SampleBadge } from "../ui";

export const L = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  soft: "bg-blue-50 text-blue-700",
};
export const AGENT = { name: "Dana Brooks", company: "Sample Realty (fictional)" };

const item = ({ isActive }: { isActive: boolean }) =>
  `flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"}`;

export default function LeaseHubLayout() {
  const { applications } = useDemo();
  const fresh = applications.filter((a) => a.status === "new").length;
  return (
    <div className="flex min-h-full flex-col bg-slate-100">
      <PortalBar current="leasehub" wide />
      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="flex shrink-0 flex-col gap-4 bg-slate-900 px-3 py-4 md:w-60 md:py-5">
          <Link to="/leasehub" className="flex items-center gap-2 px-2 text-lg font-bold tracking-tight text-white" aria-label="LeaseHub home">
            <LeaseHubMark /> LeaseHub
          </Link>
          <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label="LeaseHub">
            <NavLink to="/leasehub" end className={item}>Dashboard</NavLink>
            <NavLink to="/leasehub/listings/new" className={item}>New listing</NavLink>
            <NavLink to={applications[0] ? `/leasehub/applications/${applications[0].id}` : "/leasehub"} className={item}>
              Applications {fresh > 0 && <span className="ml-2 rounded-full bg-blue-500 px-1.5 text-[11px] text-white">{fresh}</span>}
            </NavLink>
          </nav>
          <div className="mt-auto hidden px-2 md:block"><PoweredBy dark /></div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5 md:px-6">
            <span className="text-sm text-slate-500">Agent workspace</span>
            <div className="flex items-center gap-2">
              <SampleBadge />
              <span className="flex items-center gap-2 text-sm text-slate-700">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-800 text-[11px] font-semibold text-white">DB</span>
                {AGENT.name} <span className="hidden text-xs text-slate-400 sm:inline">· {AGENT.company}</span>
              </span>
            </div>
          </header>
          <main className="flex-1 px-4 py-5 md:px-6">
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
      <DemoBar />
    </div>
  );
}
