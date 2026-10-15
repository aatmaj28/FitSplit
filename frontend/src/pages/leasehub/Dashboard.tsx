import { Link } from "react-router";
import { listing, money } from "../../data/listings";
import { useDemo, type AgentListing } from "../../data/store";
import { VerdictBadge } from "../../roommates/NegotiationView";
import { EmptyState, Stat } from "../ui";
import { L } from "./LeaseHubLayout";

export function listingInfo(a: AgentListing) {
  const base = listing(a.id);
  return base ? { title: base.title, rent: base.rent, beds: base.beds, baths: base.baths, sqft: base.sqft, image: base.image } : { ...a.custom!, image: a.custom?.imageUrl };
}

// time saved: an estimate from sample numbers, and labelled as one
const Q_PER_VIEW = 1 / 3; // one in three viewers would otherwise ask "how big is the room?"
const MIN_PER_QUESTION = 5;

export default function Dashboard() {
  const { listings, applications, showings } = useDemo();
  const views = listings.reduce((s, l) => s + l.views3d, 0);
  const questions = Math.round(views * Q_PER_VIEW);
  const hours = (questions * MIN_PER_QUESTION) / 60;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500">Every listing goes out with a 3D floor plan and real room sizes.</p>
        </div>
        <Link to="/leasehub/listings/new" className={`rounded-lg px-4 py-2 text-sm font-semibold ${L.primary}`}>+ New listing</Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active listings" value={listings.filter((l) => l.status === "published").length} />
        <Stat label="3D tours viewed" value={views} hint="sample numbers" />
        <Stat label="Group applications" value={applications.length} hint={`${applications.filter((a) => a.status === "new").length} new`} />
        <Stat label="Showing requests" value={showings.length} />
      </div>

      <section className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 p-5 text-white shadow-sm" aria-label="Time saved estimate">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-100">Time saved (estimate)</div>
        <div className="mt-1 flex flex-wrap items-end gap-x-8 gap-y-2">
          <div><span className="text-3xl font-bold">≈ {questions}</span> <span className="text-blue-100">room-size questions answered by the 3D view</span></div>
          <div><span className="text-3xl font-bold">≈ {hours.toFixed(1)} h</span> <span className="text-blue-100">of calls and emails</span></div>
        </div>
        <p className="mt-2 text-xs text-blue-100">Estimate from sample numbers: 3D tours ÷ 3 × {MIN_PER_QUESTION} min per "how big is the room?" question. Group applications arrive with exact shares and furniture checked, so fewer wasted showings.</p>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200" aria-label="My listings">
          <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">My listings</h2>
          <ul className="divide-y divide-slate-100">
            {listings.map((a) => {
              const info = listingInfo(a);
              return (
                <li key={a.id}>
                  <Link to={`/leasehub/listings/${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50" data-agent-listing={a.id}>
                    <div className="h-14 w-16 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
                      {info.image && <img src={info.image} alt="" className="h-full w-full object-contain p-1" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-slate-900">{info.title}</div>
                      <div className="text-xs text-slate-500">{money(info.rent)}/mo · {info.beds} bd / {info.baths} ba · {info.sqft.toLocaleString()} sq ft</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {a.syndicated.map((s) => <span key={s} className="rounded bg-slate-100 px-1.5 py-px text-[10px] text-slate-600">{s} ✓</span>)}
                      </div>
                    </div>
                    <div className="hidden text-right text-xs text-slate-500 sm:block">
                      <div className="font-medium text-emerald-700">Published</div>
                      <div>{a.publishedAt}</div>
                      <div>{a.views3d} 3D views</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="space-y-5">
          <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200" aria-label="Group applications">
            <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">Group applications</h2>
            {applications.length ? (
              <ul className="divide-y divide-slate-100">
                {applications.map((app) => (
                  <li key={app.id}>
                    <Link to={`/leasehub/applications/${app.id}`} className="block px-4 py-3 hover:bg-slate-50" data-application={app.id}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-900">{listing(app.listingId)?.title ?? app.listingId}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${app.status === "new" ? "bg-blue-100 text-blue-800" : app.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{app.status}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">{app.members.map((m) => m.name.split(" ")[0]).join(", ")} · {money(app.members.reduce((s, m) => s + m.share, 0))}/mo</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {app.rentCheck && <span className={`rounded-full px-2 py-0.5 ${app.rentCheck.verdict === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{app.rentCheck.verdict === "ok" ? "AI checked ✓" : "AI check: review"}</span>}
                        {app.compatibility && <VerdictBadge status={app.compatibility.status} />}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4"><EmptyState title="No applications yet">Groups that match on Roombae and apply land here, with every roommate's share.</EmptyState></div>
            )}
          </section>
          <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200" aria-label="Showing requests">
            <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">Showing requests <span className="text-xs font-normal text-slate-400">(sample)</span></h2>
            <ul className="divide-y divide-slate-100">
              {showings.map((s) => (
                <li key={s.id} className="px-4 py-2.5 text-sm">
                  <div className="flex justify-between gap-2"><span className="font-medium text-slate-800">{s.name}</span><span className="text-xs text-slate-500">{s.when}</span></div>
                  <div className="text-xs text-slate-500">{listing(s.listingId)?.title} · {s.note}</div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
