import { Link, useParams } from "react-router";
import { FloorPlan3D } from "../../components/FloorPlan3D";
import { formatSqft } from "../../components/FloorPlan3D/theme";
import { money } from "../../data/listings";
import { usePlan } from "../../data/plans";
import { useDemo } from "../../data/store";
import { EmptyState, ErrorState, PageLoading, Stat } from "../ui";
import { listingInfo } from "./Dashboard";
import { L } from "./LeaseHubLayout";

export default function AgentListing() {
  const { id } = useParams();
  const { listings, applications } = useDemo();
  const a = listings.find((x) => x.id === id);
  const { data, error } = usePlan(a ? id : undefined);
  if (!a) return <EmptyState title="Listing not found" action={<Link to="/leasehub" className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${L.primary}`}>Dashboard</Link>} />;
  const info = listingInfo(a);
  const apps = applications.filter((x) => x.listingId === id);
  const rooms = data ? data.plan.rooms.filter((r) => r.type !== "closet").sort((x, y) => (y.area_sqft_final ?? 0) - (x.area_sqft_final ?? 0)) : [];
  return (
    <div className="space-y-4">
      <div className="text-sm"><Link to="/leasehub" className="text-slate-500 hover:text-slate-800">← Dashboard</Link></div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{info.title}</h1>
          <p className="text-sm text-slate-500">Boston, MA · {money(info.rent)}/mo · {info.beds} bd / {info.baths} ba · {info.sqft.toLocaleString()} sq ft · published {a.publishedAt}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">{a.syndicated.map((s) => <span key={s} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">{s} ✓</span>)}</div>
        </div>
        <Link to={`/roombae/listings/${a.id}`} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">See what renters see →</Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="3D tours viewed" value={a.views3d} hint="sample numbers" />
        <Stat label="Group applications" value={apps.length} />
        <Stat label="Rooms measured" value={rooms.length} hint="from the floor plan" />
      </div>
      {error ? (
        <ErrorState title="Couldn't load the floor plan">{error}</ErrorState>
      ) : !data ? (
        <PageLoading label="Loading the 3D view…" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="relative h-[60vh] min-h-[400px]"><FloorPlan3D plan={data.plan} imageUrl={data.imageUrl} /></div>
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="font-semibold text-slate-900">Room sizes, as renters see them</h2>
            <p className="text-xs text-slate-500">Printed dimensions where the plan has them, measured from the drawing otherwise.</p>
            <table className="mt-2 w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400"><th className="py-1 font-medium">Room</th><th className="py-1 text-right font-medium">Dims</th><th className="py-1 text-right font-medium">Area</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rooms.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5 text-slate-800">{r.name} <span className="text-xs text-slate-400">{r.type}{r.has_private_bath ? " · own bath" : ""}</span></td>
                    <td className="py-1.5 text-right text-xs text-slate-500">{r.printed_dims_text ?? "measured"}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-800">{formatSqft(r.area_sqft_final)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
