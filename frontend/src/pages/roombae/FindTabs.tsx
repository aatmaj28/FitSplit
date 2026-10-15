import { NavLink, useLocation } from "react-router";
import { useDemo } from "../../data/store";

/** Sub-steps of "Find roommates": swipe, see who matched, then find a place together. */
export function FindTabs() {
  const { swipes } = useDemo();
  const { search } = useLocation();
  const listing = new URLSearchParams(search).get("listing");
  const keep = listing ? `?listing=${listing}` : "";
  const likes = swipes.filter((s) => s.dir === "like").length;
  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-white hover:text-slate-900"}`;
  return (
    <nav className="inline-flex flex-wrap gap-1 rounded-full bg-slate-100 p-1" aria-label="Find roommates">
      <NavLink to={`/roombae/discover${keep}`} className={tab}><span aria-hidden>1</span> Discover</NavLink>
      <NavLink to={`/roombae/matches${keep}`} className={tab}>
        <span aria-hidden>2</span> My matches{likes > 0 && <span className="rounded-full bg-[#e8553e] px-1.5 text-[11px] text-white">{likes}</span>}
      </NavLink>
      <NavLink to={`/roombae/roommates${keep}`} className={tab}><span aria-hidden>3</span> Find a place together</NavLink>
    </nav>
  );
}
