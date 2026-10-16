import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useCatalog, type CatalogListing } from "../../data/catalog";
import { baths, LISTINGS, money, type Listing } from "../../data/listings";
import { getPlan } from "../../data/plans";
import { useDemo } from "../../data/store";
import { computeSplit } from "../../rentSplit";
import { MediaImg } from "../../media/PhotoViewer";
import { EmptyState } from "../ui";
import { R } from "./RoombaeLayout";

/** Fair-split room prices per listing (from the parsed plans), e.g. JVUE 3 bed: $1,352 to $1,488. */
export function useRoomPrices(): Record<string, { min: number; max: number }> {
  const [prices, setPrices] = useState<Record<string, { min: number; max: number }>>({});
  useEffect(() => {
    let alive = true;
    for (const l of LISTINGS) {
      getPlan(l.id)
        .then(({ plan }) => {
          const shares = computeSplit(plan, { method: "fair", includeClosets: false, rent: l.rent }).rows.map((r) => r.share);
          if (alive && shares.length) setPrices((p) => ({ ...p, [l.id]: { min: Math.min(...shares), max: Math.max(...shares) } }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, []);
  return prices;
}

export function ListingCard({ l, price, badge }: { l: Listing | CatalogListing; price?: { min: number; max: number }; badge?: React.ReactNode }) {
  const c = l as Partial<CatalogListing>;
  const photo = c.fromMedia && c.media?.cover ? c.media : null;
  const has = [c.fromMedia ? null : "3D view", c.media ? "Photos" : null].filter(Boolean).join(" · ");
  return (
    <Link to={`/roombae/listings/${l.id}`} className="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md" data-listing={l.id}>
      <div className="relative aspect-[4/3] overflow-hidden bg-white">
        {photo ? (
          <MediaImg jobId={photo.jobId} file={photo.cover!} alt={`${l.title} photo`} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <img src={l.image} alt={`${l.title} floor plan`} loading="lazy" className="absolute inset-0 h-full w-full object-contain p-3" />
        )}
        <span className="absolute left-2 top-2 rounded-full bg-slate-900/80 px-2 py-0.5 text-[11px] font-semibold text-white">{has}</span>
        {badge && <span className="absolute right-2 top-2">{badge}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1 border-t border-slate-100 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="font-semibold text-slate-900">{l.title}</div>
          <div className="text-right font-semibold text-slate-900">{money(l.rent)}<span className="text-xs font-normal text-slate-400">/mo</span></div>
        </div>
        <div className="text-xs text-slate-500">
          {l.location} · {l.beds} bed · {baths(l.baths)} · {l.sqft.toLocaleString()} sq ft
        </div>
        {l.beds > 1 && c.fromMedia !== true && (
          <div className="text-xs text-slate-600">
            {price ? <>Rooms {money(price.min)} to {money(price.max)}/mo <span className="text-slate-400">(fair split)</span></> : <span className="text-slate-400">Working out room prices…</span>}
          </div>
        )}
      </div>
    </Link>
  );
}

const BUDGETS = [0, 1300, 1400, 1500, 1800, 2700, 4000];

export default function Listings() {
  const [params, setParams] = useSearchParams();
  const { group, listings: published } = useDemo();
  const catalog = useCatalog();
  const prices = useRoomPrices();
  const q = params.get("q") ?? "";
  const beds = params.get("beds") ?? "any";
  const budget = Number(params.get("budget") ?? 0);
  const fitsGroup = params.get("group") === "1";
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v === null || v === "" || v === "any" || v === "0") p.delete(k);
    else p.set(k, v);
    setParams(p, { replace: true });
  };
  const shown = useMemo(
    () =>
      catalog
        .filter((l) => !q || l.title.toLowerCase().includes(q.toLowerCase()))
        .filter((l) => beds === "any" || l.beds === Number(beds))
        .filter((l) => !budget || (prices[l.id]?.min ?? l.rent / l.beds) <= budget)
        .filter((l) => !fitsGroup || !group || l.beds === group.members.length),
    [q, beds, budget, fitsGroup, group, prices, published], // eslint-disable-line react-hooks/exhaustive-deps -- catalog derives from published
  );
  const chip = (active: boolean) => `rounded-full px-3 py-1 text-sm font-medium ring-1 transition-colors ${active ? `${R.soft} ring-[#e8553e]/40` : "bg-white text-slate-600 ring-slate-200 hover:text-slate-900"}`;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Listings in Boston, MA</h1>
          <p className="text-sm text-slate-500">Every listing has a 3D floor plan with real room sizes. Open one to check your furniture and split the rent.</p>
        </div>
        <input value={q} onChange={(e) => set("q", e.target.value)} placeholder="Search" aria-label="Search listings"
          className="w-48 rounded-full bg-white px-3.5 py-1.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-[#e8553e]/40" />
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        {["any", "1", "2", "3"].map((b) => (
          <button key={b} type="button" onClick={() => set("beds", b)} aria-pressed={beds === b} className={chip(beds === b)}>
            {b === "any" ? "Any beds" : `${b} bed${b === "1" ? "" : "s"}`}
          </button>
        ))}
        <label className="ml-1 flex items-center gap-2 text-sm text-slate-600">
          Room budget
          <select value={budget} onChange={(e) => set("budget", e.target.value)} className="rounded-full bg-white px-3 py-1 text-sm ring-1 ring-slate-200">
            {BUDGETS.map((b) => <option key={b} value={b}>{b ? `up to ${money(b)}` : "any"}</option>)}
          </select>
        </label>
        {group && (
          <button type="button" onClick={() => set("group", fitsGroup ? null : "1")} aria-pressed={fitsGroup} className={chip(fitsGroup)}>
            Fits my group of {group.members.length}
          </button>
        )}
      </div>
      {shown.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((l) => <ListingCard key={l.id} l={l} price={prices[l.id]} badge={group && l.beds === group.members.length ? <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">Fits your group</span> : undefined} />)}
        </div>
      ) : (
        <EmptyState title="No listings match these filters" action={<button type="button" onClick={() => setParams({}, { replace: true })} className={`rounded-full px-4 py-1.5 text-sm font-medium ${R.primary}`}>Clear filters</button>}>
          Try a different number of bedrooms or a higher room budget.
        </EmptyState>
      )}
    </div>
  );
}
