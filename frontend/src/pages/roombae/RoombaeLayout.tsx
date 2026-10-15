import { Suspense } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { DemoBar } from "../demo/DemoBar";
import { Avatar } from "../../roommates/NegotiationView";
import { PortalBar, RoombaeMark } from "../portals";
import { PageLoading, PoweredBy, SampleBadge } from "../ui";

export const R = {
  primary: "bg-[#e8553e] text-white hover:bg-[#d4452f]",
  text: "text-[#d4452f]",
  soft: "bg-[#fff1ec] text-[#b8392a]",
};

const nav = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${isActive ? "bg-[#fff1ec] text-[#b8392a]" : "text-slate-600 hover:text-slate-900"}`;

export default function RoombaeLayout() {
  const { pathname } = useLocation();
  const finding = /^\/roombae\/(discover|matches|roommates)/.test(pathname);
  return (
    <div className="flex min-h-full flex-col bg-[#fbf8f5]">
      <PortalBar current="roombae" />
      <header className="sticky top-0 z-40 border-b border-orange-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
          <Link to="/roombae" className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900" aria-label="Roombae home">
            <RoombaeMark /> Roombae
          </Link>
          <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto" aria-label="Roombae">
            <NavLink to="/roombae/listings" className={nav}>Listings</NavLink>
            <NavLink to="/roombae/discover" className={() => nav({ isActive: finding })}>Find roommates</NavLink>
            <NavLink to="/roombae/fill-room" className={nav}>Fill a room</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <SampleBadge />
            <span className="flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-0.5 pr-2.5 text-xs font-medium text-slate-700" title="Signed in as the demo student">
              <Avatar id="priya" name="Priya Sharma" color="#0d9488" size={6} />
              Priya S.
            </span>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </main>
      <DemoBar />
      <footer className="border-t border-orange-100 bg-white/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-slate-400">
          <span>Mock Roombae portal for a hackathon demo. Listings and students are sample data.</span>
          <PoweredBy />
        </div>
      </footer>
    </div>
  );
}
