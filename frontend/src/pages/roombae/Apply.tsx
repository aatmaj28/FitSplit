import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { RentSplit } from "../../components/RentSplit";
import { listing, money } from "../../data/listings";
import { usePlan } from "../../data/plans";
import { demo, useDemo, type Application } from "../../data/store";
import { cachedRentCheck, rentCheckRequest } from "../../rentCheck";
import type { SplitMethod, SplitResult } from "../../rentSplit";
import type { Profile, Verdict } from "../../roommates/api";
import { assignRooms } from "../../roommates/fit";
import { useNegotiationRecords, useProfiles, useScenarios } from "../../roommates/hooks";
import { Avatar, VerdictBadge } from "../../roommates/NegotiationView";
import { EmptyState, ErrorState, PageLoading, SampleBadge } from "../ui";
import { R } from "./RoombaeLayout";
import { ME } from "./RoommateFinder";

type Split = { split: SplitResult; opts: { method: SplitMethod; includeClosets: boolean } };

export default function Apply() {
  const { id } = useParams();
  const l = listing(id);
  const { data, error } = usePlan(l?.id);
  const { group } = useDemo();
  const { profiles, loading } = useProfiles();
  const sc = useScenarios();
  const [s, setS] = useState<Split | null>(null);
  const [rooms, setRooms] = useState<Record<string, string>>({}); // person -> room id (after manual changes)
  const [check, setCheck] = useState<Application["rentCheck"]>(null);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<Application | null>(null);

  // who is applying: the saved group, else the best bundled group, else just you
  const ids = useMemo(() => {
    if (!l) return [ME];
    if (group?.members.length === l.beds) return group.members;
    const best = sc.data?.find.groups.find((g) => g.members.length === l.beds);
    return best ? [ME, ...best.members.filter((m) => m !== ME)] : [ME];
  }, [l, group, sc.data]);
  const people = ids.map((i) => profiles.find((p) => p.id === i)).filter((p): p is Profile => !!p);
  const pairs = useMemo(() => {
    const all = sc.data?.find.pairs ?? [];
    return all.filter((p) => ids.includes(p.a) && ids.includes(p.b));
  }, [sc.data, ids]);
  const recs = useNegotiationRecords(pairs.map((p) => p.id));

  // best room for each person within budget; manual changes win
  const auto = useMemo(() => (s && people.length === s.split.rows.length ? assignRooms(people, s.split.rows) : null), [s, people.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (auto) setRooms(Object.fromEntries(auto.assignment.map((a) => [a.person.id, a.row.room.id])));
  }, [auto]);
  useEffect(() => {
    if (!s || !l) return;
    let alive = true;
    cachedRentCheck(rentCheckRequest(l.id, s.split, s.opts)).then((r) => {
      if (!alive) return;
      setCheck(r ? { verdict: r.verdict, note: r.verdict === "ok" ? "AI checked: inputs match the floor plan" : `AI check: ${r.checks.filter((c) => c.status === "warn").length + r.suggestions.length} point(s) to review` } : null);
    });
    return () => {
      alive = false;
    };
  }, [s, l]);
  useEffect(() => {
    if (l && people.length > 1 && !message)
      setMessage(`Hi! We're ${people.length} grad students (${[...new Set(people.map((p) => p.school))].join(", ")}) who matched as roommates on Roombae. We've checked our furniture in the 3D floor plan and agreed on a fair split. We'd love to see ${l.title}.`);
  }, [l, people.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!l) return <EmptyState title="Listing not found" />;
  if (error) return <ErrorState title="Couldn't load the floor plan">{error}</ErrorState>;
  if (!data || loading) return <PageLoading label="Preparing the application…" />;

  const rows = s?.split.rows ?? [];
  const label = (rid: string) => {
    const i = rows.findIndex((r) => r.room.id === rid);
    return i < 0 ? "?" : `Bedroom ${i + 1} (${rows[i].room.name})`;
  };
  const chosen = people.map((p) => rows.find((r) => r.room.id === rooms[p.id]));
  const unique = new Set(chosen.map((r) => r?.room.id)).size === people.length && chosen.every(Boolean);
  const total = chosen.reduce((sum, r) => sum + (r?.share ?? 0), 0);
  const ready = s && unique && people.length === rows.length;
  const worst: Verdict | null = pairs.length ? (pairs.some((p) => p.status === "incompatible") ? "incompatible" : pairs.some((p) => p.status === "conditional") ? "conditional" : "strong") : null;

  const submit = () => {
    if (!ready || !s) return;
    setSent(
      demo.submitApplication({
        listingId: l.id,
        rent: s.split.rent,
        method: s.opts.method,
        members: people.map((p, i) => ({ profileId: p.id, name: p.name, roomId: chosen[i]!.room.id, roomLabel: label(chosen[i]!.room.id), share: chosen[i]!.share })),
        rentCheck: check,
        compatibility: worst ? { status: worst, pairs: pairs.map((p) => ({ a: p.a, b: p.b, status: p.status ?? "conditional", overall: recs[p.id]?.analysis?.scores.overall ?? null })) } : null,
        message,
      }),
    );
  };

  if (sent) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-6 text-center" data-applied={sent.id}>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
        <h1 className="text-2xl font-bold text-slate-900">Application sent</h1>
        <p className="text-slate-600">{sent.members.map((m) => m.name.split(" ")[0]).join(", ")} applied for {l.title} as a group. The agent sees every roommate's exact share, the AI rent check and your compatibility on LeaseHub.</p>
        <div className="flex justify-center gap-2">
          <Link to={`/leasehub/applications/${sent.id}`} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">See it as the agent (LeaseHub) →</Link>
          <Link to={`/roombae/listings/${l.id}`} className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300">Back to the listing</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm"><Link to={`/roombae/listings/${l.id}`} className="text-slate-500 hover:text-slate-800">← {l.title}</Link></div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Apply {people.length > 1 ? "as a group" : ""} for {l.title}</h1>
        <SampleBadge />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" aria-label="Application">
          <div>
            <h2 className="font-semibold text-slate-900">Roommates and their shares</h2>
            <p className="text-xs text-slate-500">Shares come straight from the rent split on the right; rooms are matched to budgets. Change a room if you agreed otherwise.</p>
          </div>
          <ul className="space-y-2">
            {people.map((p, i) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-3 py-2" data-member={p.id}>
                <Avatar id={p.id} name={p.name} color={p.color} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">{p.name}{p.id === ME && <span className="text-xs font-normal text-slate-400"> (you)</span>}</span>
                  <span className="block text-xs text-slate-500">{p.program}, {p.school}</span>
                </span>
                <select value={rooms[p.id] ?? ""} onChange={(e) => setRooms((r) => ({ ...r, [p.id]: e.target.value }))} aria-label={`Room for ${p.name}`}
                  className="rounded-lg bg-white px-2 py-1 text-sm ring-1 ring-slate-200">
                  {rows.map((r) => <option key={r.room.id} value={r.room.id}>{label(r.room.id)}</option>)}
                </select>
                <span className="w-20 text-right text-base font-semibold tabular-nums text-slate-900">{chosen[i] ? money(chosen[i]!.share) : "—"}</span>
              </li>
            ))}
          </ul>
          {people.length !== rows.length && rows.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">This unit has {rows.length} bedrooms but your group has {people.length} people. <Link to={`/roombae/discover?listing=${l.id}`} className="font-medium underline">Find roommates</Link> first.</p>
          )}
          {!unique && people.length === rows.length && <p className="text-xs text-rose-700">Two people picked the same room.</p>}
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-600">Total</span>
            <span className={`font-semibold tabular-nums ${total === Math.round(s?.split.rent ?? 0) ? "text-teal-700" : "text-rose-700"}`}>{money(total)} {total === Math.round(s?.split.rent ?? 0) ? "= rent ✓" : `of ${money(s?.split.rent ?? 0)}`}</span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {check && <span className={`rounded-full px-2.5 py-1 font-medium ring-1 ${check.verdict === "ok" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>{check.note}</span>}
            {worst && <span className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">Roommate compatibility <VerdictBadge status={worst} /></span>}
          </div>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">Message to the agent</span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="mt-1 w-full rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#e8553e]/40" />
          </label>
          <button type="button" disabled={!ready} onClick={submit} className={`w-full rounded-full px-4 py-2.5 text-sm font-semibold ${R.primary} disabled:opacity-50`}>
            Submit {people.length > 1 ? "group " : ""}application
          </button>
          <p className="text-[11px] text-slate-400">Goes to the listing agent on LeaseHub (mock). Nothing leaves this browser.</p>
        </section>
        <RentSplit key={l.id} plan={data.plan} onSplit={(split, opts) => setS({ split, opts })} className="self-start" />
      </div>
    </div>
  );
}
