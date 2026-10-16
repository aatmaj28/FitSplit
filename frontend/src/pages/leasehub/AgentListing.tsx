import { Link, useParams, useSearchParams } from "react-router";
import { FloorPlan3D } from "../../components/FloorPlan3D";
import { estimateLabel, formatRoomArea } from "../../components/FloorPlan3D/theme";
import { listing, money } from "../../data/listings";
import { usePlan } from "../../data/plans";
import { useDemo } from "../../data/store";
import { estimatedPlan, layoutRects } from "../../media/api";
import { useMediaJob } from "../../media/hooks";
import { ListingAmenities, PhotoGallery } from "../../media/ListingMedia";
import { RoomPhotos } from "../../media/RoomPhotos";
import { listingLook } from "../../media/style";
import { walkOf, Walkthrough } from "../../media/Walkthrough";
import { EmptyState, ErrorState, PageLoading, Stat, ViewTabs } from "../ui";
import { listingInfo } from "./Dashboard";
import { L } from "./LeaseHubLayout";

type View = "3d" | "walk" | "photos";

export default function AgentListing() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { listings, applications } = useDemo();
  const a = listings.find((x) => x.id === id);
  // listings made from a video have no parsed floor plan (unless the video was added to one)
  const hasPlan = Boolean(a && (listing(a.id) || !a.media));
  const { data, error } = usePlan(a && hasPlan ? id : undefined);
  const { job } = useMediaJob(a?.media?.jobId);
  if (!a) return <EmptyState title="Listing not found" action={<Link to="/leasehub" className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${L.primary}`}>Dashboard</Link>} />;
  const info = listingInfo(a);
  const apps = applications.filter((x) => x.listingId === id);
  const media = a.media && job?.status === "complete" ? job : null;
  const est = !hasPlan && media ? estimatedPlan(media, info.rent) : null;
  const plan3d = hasPlan ? data : est;
  const rooms = plan3d ? plan3d.plan.rooms.filter((r) => r.type !== "closet").sort((x, y) => (y.area_sqft_final ?? 0) - (x.area_sqft_final ?? 0)) : [];
  const walk = a.media ? walkOf(job) : null;
  const look = plan3d && media ? listingLook(plan3d.plan, media) : null;
  const walkTab = walk || (a.media && !job) ? [{ id: "walk" as const, label: "Walkthrough" }] : [];
  const tab3d = hasPlan || est ? [{ id: "3d" as const, label: "3D" }] : [];
  const photoTab = a.media ? [{ id: "photos" as const, label: "Photos" }] : [];
  const tabs: { id: View; label: string }[] = hasPlan ? [...tab3d, ...walkTab, ...photoTab] : [...walkTab, ...tab3d, ...photoTab];
  const asked = params.get("view") as View | null;
  const view: View = tabs.some((t) => t.id === asked) ? asked! : tabs[0]?.id ?? "3d";
  const setView = (v: View) => setParams(v === tabs[0]?.id ? {} : { view: v }, { replace: true });
  return (
    <div className="space-y-4">
      <div className="text-sm"><Link to="/leasehub" className="text-slate-500 hover:text-slate-800">← Dashboard</Link></div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{info.title}</h1>
          <p className="text-sm text-slate-500">
            {a.custom?.location || "Boston, MA"} · {money(info.rent)}/mo · {info.beds} bd / {info.baths} ba
            {info.sqft ? ` · ${info.sqft.toLocaleString()} sq ft` : est?.plan.unit.total_sqft ? ` · ≈ ${est.plan.unit.total_sqft.toLocaleString()} sq ft (${estimateLabel(est.plan).toLowerCase()})` : ""} · published {a.publishedAt}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">{a.syndicated.map((s) => <span key={s} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">{s} ✓</span>)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewTabs value={view} onChange={setView} tabs={tabs} />
          <Link to={`/roombae/listings/${a.id}`} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">See what renters see →</Link>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="3D tours viewed" value={a.views3d} />
        <Stat label="Group applications" value={apps.length} />
        {a.media ? (
          <Stat label="Amenities tagged" value={a.media.amenities.length} hint={media ? `from ${media.frames.length} photos` : undefined} />
        ) : (
          <Stat label="Rooms measured" value={rooms.length} hint="from the floor plan" />
        )}
      </div>
      {view === "walk" ? (
        media && walk ? <div className="h-[60vh] min-h-[400px]"><Walkthrough job={media} walk={walk} rects={layoutRects(media)} /></div> : <PageLoading label="Loading the walkthrough…" />
      ) : view === "photos" ? (
        media ? <div className="h-[60vh] min-h-[400px]"><PhotoGallery job={media} /></div> : <PageLoading label="Loading the photos…" />
      ) : error && hasPlan ? (
        <ErrorState title="Couldn't load the floor plan">{error}</ErrorState>
      ) : !plan3d ? (
        <PageLoading label="Loading the 3D view…" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="relative h-[60vh] min-h-[400px]">
            <FloorPlan3D plan={plan3d.plan} imageUrl={plan3d.imageUrl} initialLivedIn roomStyle={look?.styles}
              roomExtra={media && look ? (room) => <RoomPhotos job={media} frames={look.frames[room.id]} name={room.name} /> : undefined} />
          </div>
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="font-semibold text-slate-900">Room sizes, as renters see them</h2>
            <p className="text-xs text-slate-500">
              {est ? `${estimateLabel(est.plan)}: measured against doors, appliances and beds in the photos. Room positions are schematic.` : "Printed dimensions where the plan has them, measured from the drawing otherwise."}
            </p>
            <table className="mt-2 w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400"><th className="py-1 font-medium">Room</th><th className="py-1 text-right font-medium">Dims</th><th className="py-1 text-right font-medium">Area</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rooms.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5 text-slate-800">{r.name} <span className="text-xs text-slate-400">{r.type}{r.has_private_bath ? " · own bath" : ""}</span></td>
                    <td className="py-1.5 text-right text-xs text-slate-500">{r.printed_dims_text ?? "measured"}{r.dims_confidence ? ` ±${r.dims_confidence.plus_minus_pct}%` : ""}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-800">{formatRoomArea(r, r.area_sqft_final)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
      {a.media && media && <ListingAmenities media={a.media} job={media} tone="blue" />}
    </div>
  );
}
