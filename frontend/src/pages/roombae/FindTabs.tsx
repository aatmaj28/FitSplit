import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router";
import { useDemo } from "../../data/store";

/** Sub-steps of "Find roommates": swipe, see who matched, then find a place together. */
export function FindTabs() {
  const { swipes } = useDemo();
  const { search, pathname } = useLocation();
  const listing = new URLSearchParams(search).get("listing");
  const keep = listing ? `?listing=${listing}` : "";
  const likes = swipes.filter((s) => s.dir === "like").length;
  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] ring-1 transition-all sm:px-3.5 sm:text-sm ${
      isActive
        ? "bg-slate-900 font-bold text-white shadow-md ring-slate-900"
        : "bg-white font-medium text-slate-700 shadow-sm ring-slate-300 hover:-translate-y-px hover:bg-orange-50 hover:text-slate-900 hover:ring-[#e8553e]/50"
    }`;
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    // on a narrow screen the strip scrolls sideways: keep the current tab in view (never scrolls the page)
    const el = nav.current, active = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && active) el.scrollLeft = Math.max(0, active.offsetLeft - el.offsetLeft - 8);
  }, [pathname]);
  const num = (n: number) => <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-current/10 text-[11px] font-bold">{n}</span>;
  return (
    <nav ref={nav} className="flex max-w-full gap-1.5 overflow-x-auto p-0.5" aria-label="Find roommates">
      <NavLink to={`/roombae/discover${keep}`} className={tab}>{num(1)} Discover</NavLink>
      <NavLink to={`/roombae/matches${keep}`} className={tab}>
        {num(2)} <span className="sm:hidden">Matches</span><span className="hidden sm:inline">My matches</span>{likes > 0 && <span className="rounded-full bg-[#e8553e] px-1.5 text-[11px] font-semibold text-white">{likes}</span>}
      </NavLink>
      <NavLink to={`/roombae/roommates${keep}`} className={tab}>
        {num(3)} <span className="sm:hidden">Places</span><span className="hidden sm:inline">Find a place together</span>
      </NavLink>
      <NavLink to={`/roombae/group-chat${keep}`} className={tab}>{num(4)} <span className="sm:hidden">Chat</span><span className="hidden sm:inline">Group chat</span></NavLink>
    </nav>
  );
}
