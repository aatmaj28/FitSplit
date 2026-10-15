import { useState } from "react";
import { Link, useParams } from "react-router";
import { FloorPlan3D } from "../../components/FloorPlan3D";
import { RentSplit } from "../../components/RentSplit";
import { baths, listing, money } from "../../data/listings";
import { usePlan } from "../../data/plans";
import { useDemo } from "../../data/store";
import { EmptyState, ErrorState, PageLoading, SampleBadge } from "../ui";
import { R } from "./RoombaeLayout";

export default function ListingDetail() {
  const { id } = useParams();
  const l = listing(id);
  const { data, error } = usePlan(l?.id);
  const { group } = useDemo();
  const [roomId, setRoomId] = useState<string | null>(null);
  if (!l) return <EmptyState title="Listing not found" action={<Link to="/roombae/listings" className={`rounded-full px-4 py-1.5 text-sm font-medium ${R.primary}`}>All listings</Link>} />;
  const ours = group?.listingId === l.id;
  return (
    <div className="space-y-4">
      <div className="text-sm"><Link to="/roombae/listings" className="text-slate-500 hover:text-slate-800">← Listings</Link></div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{l.title}</h1>
            <SampleBadge>Sample listing</SampleBadge>
            {ours && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">Your group's pick</span>}
          </div>
          <p className="text-sm text-slate-500">{l.location} · {l.beds} bed · {baths(l.baths)} · {l.sqft.toLocaleString()} sq ft · {money(l.rent)}/mo</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {l.beds > 1 && (
            <Link to={`/roombae/roommates?listing=${l.id}`} className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
              Find roommates for this unit
            </Link>
          )}
          <Link to={`/roombae/apply/${l.id}`} className={`rounded-full px-4 py-2 text-sm font-semibold ${R.primary}`}>
            {l.beds > 1 ? "Apply as a group" : "Apply"}
          </Link>
        </div>
      </div>
      {error ? (
        <ErrorState title="Couldn't load this floor plan">{error}</ErrorState>
      ) : !data ? (
        <PageLoading label="Loading the floor plan…" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <div className="relative h-[62vh] min-h-[420px] sm:h-[68vh]">
              <FloorPlan3D plan={data.plan} imageUrl={data.imageUrl} editable selectedRoomId={roomId} onRoomSelect={(r) => setRoomId(r?.id ?? null)} />
            </div>
            <p className="text-xs text-slate-500">Click a room for its size. <span className="font-medium text-slate-700">Edit layout</span> to try your furniture: green fits, red doesn't.</p>
          </div>
          <RentSplit key={l.id} plan={data.plan} selectedRoomId={roomId} onSelectRoom={setRoomId} className="self-start" />
        </div>
      )}
    </div>
  );
}
