import { Link, useParams } from "react-router";
import { baths, listing, money } from "../../data/listings";
import { demo, useDemo } from "../../data/store";
import { useProfiles } from "../../roommates/hooks";
import { Avatar } from "../../roommates/NegotiationView";
import { EmptyState } from "../ui";
import { L } from "./LeaseHubLayout";

export default function ApplicationView() {
  const { id } = useParams();
  const { applications } = useDemo();
  const { profiles } = useProfiles();
  const app = applications.find((a) => a.id === id);
  if (!app) return <EmptyState title="Application not found" action={<Link to="/leasehub" className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${L.primary}`}>Dashboard</Link>} />;
  const l = listing(app.listingId);
  const total = app.members.reduce((s, m) => s + m.share, 0);
  const prof = (pid: string | null) => profiles.find((p) => p.id === pid);
  return (
    <div className="space-y-4" data-application-view={app.id}>
      <div className="text-sm"><Link to="/leasehub" className="text-slate-500 hover:text-slate-800">← Dashboard</Link></div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Group application · {l?.title ?? app.listingId}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${app.status === "new" ? "bg-blue-100 text-blue-800" : app.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{app.status}</span>
          </div>
          <p className="text-sm text-slate-500">{app.members.length} applicants · submitted {new Date(app.submittedAt).toLocaleString()} · via Roombae</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => demo.setApplicationStatus(app.id, "reviewing")} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">Mark reviewing</button>
          <button type="button" onClick={() => demo.setApplicationStatus(app.id, "approved")} className={`rounded-lg px-3 py-2 text-sm font-semibold ${L.primary}`}>Approve group</button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" aria-label="Roommates">
          <h2 className="font-semibold text-slate-900">Roommates and shares</h2>
          <p className="text-xs text-slate-500">From the renters' fair split ({app.method === "fair" ? "room size + private bath, shared space split evenly" : "by room size"}). Each person pays their own share.</p>
          <ul className="mt-3 divide-y divide-slate-100">
            {app.members.map((m) => {
              const p = prof(m.profileId);
              return (
                <li key={m.name} className="flex items-center gap-3 py-2.5" data-applicant={m.profileId ?? m.name}>
                  {p ? <Avatar id={p.id} name={p.name} color={p.color} /> : <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">{m.name[0]}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-900">{m.name}</span>
                    <span className="block text-xs text-slate-500">{p ? `${p.program}, ${p.school}` : "Applicant"} · {m.roomLabel}</span>
                  </span>
                  <span className="text-base font-semibold tabular-nums text-slate-900">{money(m.share)}<span className="text-xs font-normal text-slate-400">/mo</span></span>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-600">Total</span>
            <span className={`font-semibold tabular-nums ${total === app.rent ? "text-emerald-700" : "text-rose-700"}`}>{money(total)} {total === app.rent ? "= rent ✓" : `≠ ${money(app.rent)}`}</span>
          </div>
          {app.message && <blockquote className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm italic text-slate-600">"{app.message}"</blockquote>}
        </section>
        {l ? (
          <section className="self-start overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200" aria-label="Listing" data-application-listing={l.id}>
            <Link to={`/leasehub/listings/${l.id}`} className="block bg-slate-50" aria-label={`Open ${l.title}`}>
              <img src={l.image} alt={`${l.title} floor plan`} className="h-56 w-full object-contain p-4" />
            </Link>
            <div className="space-y-3 border-t border-slate-100 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{l.title}</h2>
                  <p className="text-sm text-slate-500">{l.location}</p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold tabular-nums text-slate-900">{money(l.rent)}</div>
                  <div className="text-xs text-slate-500">per month</div>
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-center">
                {[["Beds", String(l.beds)], ["Baths", baths(l.baths).replace(/ baths?$/, "")], ["Sq ft", l.sqft.toLocaleString()]].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-slate-50 px-2 py-2">
                    <dd className="text-base font-semibold tabular-nums text-slate-900">{v}</dd>
                    <dt className="text-[11px] uppercase tracking-wide text-slate-500">{k}</dt>
                  </div>
                ))}
              </dl>
              <Link to={`/leasehub/listings/${l.id}`} className={`flex items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold ${L.primary}`}>
                Open listing with 3D floor plan →
              </Link>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
