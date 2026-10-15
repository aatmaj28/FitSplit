import { Link, useParams } from "react-router";
import { listing, money } from "../../data/listings";
import { demo, useDemo } from "../../data/store";
import { useProfiles } from "../../roommates/hooks";
import { Avatar, VerdictBadge } from "../../roommates/NegotiationView";
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
  const first = (pid: string) => prof(pid)?.name.split(" ")[0] ?? pid;
  return (
    <div className="space-y-4" data-application-view={app.id}>
      <div className="text-sm"><Link to="/leasehub" className="text-slate-500 hover:text-slate-800">← Dashboard</Link></div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Group application · {l?.title ?? app.listingId}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${app.status === "new" ? "bg-blue-100 text-blue-800" : app.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{app.status}</span>
            {app.sample && <span className="text-xs text-slate-400">(sample)</span>}
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
        <div className="space-y-4">
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" aria-label="AI rent check">
            <h2 className="font-semibold text-slate-900">Rent split check</h2>
            {app.rentCheck ? (
              <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${app.rentCheck.verdict === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
                {app.rentCheck.note}
              </p>
            ) : <p className="mt-2 text-sm text-slate-500">No AI check attached.</p>}
            <p className="mt-2 text-xs text-slate-400">The AI reviews the split's inputs against the floor plan (bedroom count, private baths, sizes). The numbers are computed by code.</p>
          </section>
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" aria-label="Compatibility">
            <h2 className="font-semibold text-slate-900">Roommate compatibility</h2>
            {app.compatibility ? (
              <>
                <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">Group verdict <VerdictBadge status={app.compatibility.status} /></div>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {app.compatibility.pairs.map((p) => (
                    <li key={`${p.a}-${p.b}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5">
                      <span className="text-slate-700">{first(p.a)} & {first(p.b)}</span>
                      <span className="flex items-center gap-1.5"><VerdictBadge status={p.status} />{p.overall != null && <span className="text-xs tabular-nums text-slate-500">{p.overall}/100</span>}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-slate-400">Each pair's AI clones negotiated budget, routines, guests and dealbreakers on Roombae before applying.</p>
              </>
            ) : <p className="mt-2 text-sm text-slate-500">Applied without Roombae matching.</p>}
          </section>
          {l && <Link to={`/leasehub/listings/${l.id}`} className="block text-sm font-medium text-blue-700 hover:text-blue-900">Open {l.title} with its 3D floor plan →</Link>}
        </div>
      </div>
    </div>
  );
}
