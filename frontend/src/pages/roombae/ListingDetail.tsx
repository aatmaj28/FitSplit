import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { FloorPlan3D } from "../../components/FloorPlan3D";
import { estimateLabel } from "../../components/FloorPlan3D/theme";
import { RentSplit } from "../../components/RentSplit";
import { useCatalogListing } from "../../data/catalog";
import { baths, money } from "../../data/listings";
import { usePlan } from "../../data/plans";
import { useDemo } from "../../data/store";
import { estimatedPlan, layoutRects } from "../../media/api";
import { useMediaJob } from "../../media/hooks";
import { ListingAmenities, PhotoGallery } from "../../media/ListingMedia";
import { RoomPhotos } from "../../media/RoomPhotos";
import { listingLook } from "../../media/style";
import { walkOf, Walkthrough } from "../../media/Walkthrough";
import type { SplitRow } from "../../rentSplit";
import { assignRooms } from "../../roommates/fit";
import { useProfiles } from "../../roommates/hooks";
import { EmptyState, ErrorState, PageLoading, ViewTabs } from "../ui";
import { R } from "./RoombaeLayout";

type View = "3d" | "walk" | "photos";

export default function ListingDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const l = useCatalogListing(id);
  const { data, error } = usePlan(l?.hasPlan ? l.id : undefined);
  const { job } = useMediaJob(l?.media?.jobId);
  const { group } = useDemo();
  const [roomId, setRoomId] = useState<string | null>(null);
  const { profiles } = useProfiles();
  const [rows, setRows] = useState<SplitRow[] | null>(null);
  // the saved group's names in the rent split, each in the room the budget assignment gives them
  const defaultNames = useMemo(() => {
    if (!l || !rows || !group || group.members.length !== l.beds || (group.listingId && group.listingId !== l.id)) return undefined;
    const people = group.members.map((id) => profiles.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
    const fit = people.length === rows.length ? assignRooms(people, rows) : null;
    return fit ? Object.fromEntries(fit.assignment.map((a) => [a.row.room.id, a.person.name.split(" ")[0]])) : undefined;
  }, [l, rows, group, profiles]);
  if (!l) return <EmptyState title="Listing not found" action={<Link to="/roombae/listings" className={`rounded-full px-4 py-1.5 text-sm font-medium ${R.primary}`}>All listings</Link>} />;
  const ours = group?.listingId === l.id;
  const walk = l.media ? walkOf(job) : null;
  const est = !l.hasPlan && job?.status === "complete" ? estimatedPlan(job, l.rent) : null;
  const plan3d = l.hasPlan ? data : est;
  const walkTab = walk || (l.media && !job) ? [{ id: "walk" as const, label: "Walkthrough" }] : [];
  const tab3d = l.hasPlan || est ? [{ id: "3d" as const, label: "3D" }] : [];
  const photoTab = l.media ? [{ id: "photos" as const, label: "Photos" }] : [];
  // floor plan listings open on their 3D view, listings made from a video on the walkthrough
  const tabs: { id: View; label: string }[] = l.hasPlan ? [...tab3d, ...walkTab, ...photoTab] : [...walkTab, ...tab3d, ...photoTab];
  const asked = params.get("view") as View | null;
  const view: View = tabs.some((t) => t.id === asked) ? asked! : tabs[0]?.id ?? "3d";
  const setView = (v: View) => setParams(v === tabs[0]?.id ? {} : { view: v }, { replace: true });
  const media = l.media && job?.status === "complete" ? job : null;
  const look = plan3d && media ? listingLook(plan3d.plan, media) : null;
  return (
    <div className="space-y-4">
      <div className="text-sm"><Link to="/roombae/listings" className="text-slate-500 hover:text-slate-800">← Listings</Link></div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{l.title}</h1>
            {ours && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">Your group's pick</span>}
          </div>
          <p className="text-sm text-slate-500">
            {l.location} · {l.beds} bed · {baths(l.baths)}
            {l.sqft ? ` · ${l.sqft.toLocaleString()} sq ft` : est?.plan.unit.total_sqft ? ` · ≈ ${est.plan.unit.total_sqft.toLocaleString()} sq ft` : ""} · {money(l.rent)}/mo
            {!l.sqft && est && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200">{estimateLabel(est.plan)}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewTabs value={view} onChange={setView} tabs={tabs} />
          {l.hasPlan && l.beds > 1 && (
            <Link to={`/roombae/discover?listing=${l.id}`} className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
              Find roommates for this unit
            </Link>
          )}
          {l.hasPlan && (
            <Link to={`/roombae/apply/${l.id}`} className={`rounded-full px-4 py-2 text-sm font-semibold ${R.primary}`}>
              {l.beds > 1 ? "Apply as a group" : "Apply"}
            </Link>
          )}
        </div>
      </div>
      {view === "walk" ? (
        media && walk ? (
          <div className="h-[62vh] min-h-[420px] sm:h-[68vh]"><Walkthrough job={media} walk={walk} rects={layoutRects(media)} /></div>
        ) : (
          <PageLoading label="Loading the walkthrough…" />
        )
      ) : view === "photos" ? (
        media ? (
          <div className="h-[62vh] min-h-[420px] sm:h-[68vh]"><PhotoGallery job={media} /></div>
        ) : (
          <PageLoading label="Loading the photos…" />
        )
      ) : error && l.hasPlan ? (
        <ErrorState title="Couldn't load this floor plan">{error}</ErrorState>
      ) : !plan3d ? (
        <PageLoading label="Loading the floor plan…" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <div className="relative h-[62vh] min-h-[420px] sm:h-[68vh]">
              <FloorPlan3D plan={plan3d.plan} imageUrl={plan3d.imageUrl} editable selectedRoomId={roomId} onRoomSelect={(r) => setRoomId(r?.id ?? null)}
                initialLivedIn roomStyle={look?.styles} roomExtra={media && look ? (room) => <RoomPhotos job={media} frames={look.frames[room.id]} name={room.name} /> : undefined} />
            </div>
            <p className="text-xs text-slate-500">
              Click a room for its size. <span className="font-medium text-slate-700">Edit layout</span> to try your furniture: green fits, red doesn't.
              {est && " Sizes and room positions are estimated from the listing's photos."}
            </p>
          </div>
          {plan3d.plan.rooms.some((r) => r.type === "bedroom") && (
            <RentSplit key={l.id} plan={plan3d.plan} selectedRoomId={roomId} onSelectRoom={setRoomId} onSplit={(sp) => setRows(sp.rows)} defaultNames={defaultNames} aiCheck={!est} className="self-start" />
          )}
        </div>
      )}
      {l.media && media && <ListingAmenities media={l.media} job={media} />}
    </div>
  );
}
