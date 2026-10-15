import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { FloorPlan3D } from "../../components/FloorPlan3D";
import { listing, money } from "../../data/listings";
import { usePlan } from "../../data/plans";
import { groupVerdict, type Profile, type Scenarios } from "../../roommates/api";
import { budgetOf } from "../../roommates/fit";
import { useNegotiationEvents, useNegotiationRecords, useProfiles, useScenarios } from "../../roommates/hooks";
import { Avatar, ChecksList, NegotiationView, VerdictBadge } from "../../roommates/NegotiationView";
import { ErrorState, PageLoading } from "../ui";
import { R } from "./RoombaeLayout";

type Fill = Scenarios["fill"][number];

function Interview({ fill, member, candidate, onDone, watched }: { fill: Fill; member: Profile; candidate: Profile; onDone: () => void; watched: boolean }) {
  const n = fill.negotiations.find((x) => x.member.id === member.id);
  const { events, error } = useNegotiationEvents(n?.id ?? null);
  if (!n) return null;
  if (error) return <ErrorState title="Can't show this conversation">{error}</ErrorState>;
  if (!events.length) return <PageLoading label="Connecting the clones…" />;
  return <NegotiationView key={n.id} events={events} animate={!watched} a={{ name: candidate.name, color: candidate.color, id: candidate.id }} b={{ name: member.name, color: member.color, id: member.id }} onDone={onDone} showChecks={false} />;
}

export default function FillRoom() {
  const { profiles, loading, error, retry } = useProfiles();
  const sc = useScenarios();
  const fills = sc.data?.fill ?? [];
  const room = fills[0]?.room;
  const unit = listing(room?.plan);
  const { data: plan } = usePlan(room?.plan);
  const [rule, setRule] = useState<"all" | "majority">("all");
  const [candId, setCandId] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const fill = fills.find((f) => f.candidate === candId) ?? null;
  const recs = useNegotiationRecords(fills.flatMap((f) => f.negotiations.map((n) => n.id)));
  useEffect(() => setTab(fill?.members[0]?.id ?? null), [fill]);

  const byId = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  if (loading || sc.loading) return <PageLoading label="Loading the group's apartment…" />;
  if (error || sc.error || !room) return <ErrorState title="Couldn't load Fill a room" onRetry={retry}>{error ?? sc.error ?? "No scenario bundled"}</ErrorState>;

  const members = fills[0].members.map((m) => ({ ...m, p: byId[m.id], info: room.members.find((x) => x.profile_id === m.id)! }));
  const verdictFor = (f: Fill) => {
    const results = f.negotiations.map((n) => ({ member: n.member.name.split(" ")[0], status: (recs[n.id]?.result?.status ?? n.verdict) || "incompatible" })) as { member: string; status: "strong" | "conditional" | "incompatible" }[];
    return groupVerdict(results, rule);
  };
  const candidate = fill ? byId[fill.candidate] : null;
  const allWatched = fill ? fill.negotiations.every((n) => watched.has(n.id)) : false;
  const checks = fill ? (recs[fill.negotiations[0]?.id]?.checks ?? []) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Fill a room</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            {members.map((m) => m.p?.name.split(" ")[0]).join(" and ")} have a {unit?.title} and one empty bedroom. Each candidate's clone talks to every current roommate's clone, about this exact room, its rent share and whether their furniture fits.
          </p>
        </div>
        <div className="inline-flex rounded-full bg-white p-1 text-sm ring-1 ring-slate-200" role="group" aria-label="Mode">
          <Link to="/roombae/discover" className="rounded-full px-3 py-1 text-slate-600 hover:text-slate-900">People first</Link>
          <span className="rounded-full bg-violet-50 px-3 py-1 font-medium text-violet-700" aria-current="page">Apartment first</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <div className="relative h-80 sm:h-96">
            {plan ? (
              <FloorPlan3D plan={plan.plan} imageUrl={plan.imageUrl} selectedRoomId={room.room_id} onRoomSelect={() => {}} initialView="3d"
                layoutKey={fill ? `fill_${fill.candidate}` : "fill_empty"} defaultLayout={fill?.layout ?? []} showControls={false} roomPanel={false} />
            ) : (
              <PageLoading label="Loading the 3D apartment…" />
            )}
          </div>
          <p className="text-xs text-slate-500">{fill && candidate ? `${candidate.name.split(" ")[0]}'s furniture placed in ${room.room_label} by the fit check.` : `The open room is highlighted. Pick a candidate to see their furniture in it.`}</p>
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-violet-200">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-600">Open room</div>
            <div className="mt-0.5 text-lg font-bold text-slate-900">{room.room_label}</div>
            <div className="mt-1 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-violet-50 py-2"><div className="text-lg font-bold text-slate-900">{Math.round(room.area_sqft)}</div><div className="text-[11px] text-slate-500">sq ft</div></div>
              <div className="rounded-xl bg-violet-50 py-2"><div className="text-lg font-bold text-slate-900">{money(room.share)}</div><div className="text-[11px] text-slate-500">per month</div></div>
              <div className="rounded-xl bg-violet-50 py-2"><div className="text-lg font-bold text-slate-900">{room.private_bath ? "Own" : "Shared"}</div><div className="text-[11px] text-slate-500">bathroom</div></div>
            </div>
            <p className="mt-2 text-xs text-slate-500">Share from the fair split of the {money(room.rent_total)} rent. Current roommates:</p>
            <ul className="mt-1 space-y-1">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-sm">
                  <Avatar id={m.p.id} name={m.p.name} color={m.p.color} size={6} />
                  <span className="flex-1 text-slate-700">{m.p.name} <span className="text-xs text-slate-400">· {m.p.school}</span></span>
                  <span className="text-xs text-slate-500">{m.info.room_label}, {money(m.info.share)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 text-sm ring-1 ring-slate-200">
            <span className="text-slate-600">Group decision</span>
            <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-xs" role="group" aria-label="Group decision rule">
              {(["all", "majority"] as const).map((r) => (
                <button key={r} type="button" onClick={() => setRule(r)} aria-pressed={rule === r}
                  className={`rounded-full px-3 py-1 font-medium ${rule === r ? "bg-violet-600 text-white" : "text-slate-600"}`}>
                  {r === "all" ? "Everyone agrees" : "Majority"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-800">Candidates</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          {fills.map((f) => {
            const c = byId[f.candidate];
            const b = budgetOf(c);
            const v = verdictFor(f);
            const seen = f.negotiations.every((n) => watched.has(n.id));
            return (
              <button key={f.id} type="button" onClick={() => setCandId(f.candidate)} aria-pressed={candId === f.candidate} data-candidate={f.candidate}
                className={`rounded-2xl bg-white p-3.5 text-left shadow-sm ring-1 transition ${candId === f.candidate ? "ring-2 ring-violet-500" : "ring-slate-200 hover:ring-slate-300"}`}>
                <div className="flex items-center gap-2">
                  <Avatar id={c.id} name={c.name} color={c.color} />
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-900">{c.name}</div>
                    <div className="truncate text-xs text-slate-500">{c.program}, {c.school}</div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-600">{c.bio}</p>
                <div className="mt-2 text-xs text-slate-500">Budget up to {money(b.max)}{b.flex ? ` (+${money(b.flex)} flex)` : " (hard cap)"} · brings {f.room.furniture?.items.join(", ").toLowerCase()}</div>
                <div className="mt-2">
                  {seen ? (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${v.match ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{v.match ? "Match" : "Not a match"}</span>
                  ) : (
                    <span className="text-[11px] font-medium text-violet-700">Interview →</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {fill && candidate && (
        <section className="space-y-3 rounded-2xl bg-[#fbfaff] p-4 ring-1 ring-violet-100" aria-label={`${candidate.name} interviews`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-900">{candidate.name.split(" ")[0]} meets the roommates</h2>
            <div className="inline-flex rounded-full bg-white p-0.5 text-xs ring-1 ring-slate-200" role="tablist">
              {members.map((m) => {
                const n = fill.negotiations.find((x) => x.member.id === m.id)!;
                return (
                  <button key={m.id} type="button" role="tab" aria-selected={tab === m.id} onClick={() => setTab(m.id)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ${tab === m.id ? "bg-violet-600 text-white" : "text-slate-600"}`}>
                    with {m.p.name.split(" ")[0]}
                    {watched.has(n.id) && recs[n.id]?.result && <span className={`h-2 w-2 rounded-full ${recs[n.id].result!.status === "incompatible" ? "bg-rose-400" : "bg-emerald-400"}`} aria-hidden />}
                  </button>
                );
              })}
            </div>
          </div>
          {checks.length > 0 && (
            <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Exact checks for {room.room_label}</div>
              <ChecksList checks={checks} />
            </div>
          )}
          {members.filter((m) => m.id === tab).map((m) => (
            <Interview key={`${fill.id}:${m.id}`} fill={fill} member={m.p} candidate={candidate} watched={watched.has(fill.negotiations.find((x) => x.member.id === m.id)!.id)}
              onDone={() => {
                const id = fill.negotiations.find((x) => x.member.id === m.id)!.id;
                setWatched((w) => new Set(w).add(id));
                const next = members.find((x) => !watched.has(fill.negotiations.find((n) => n.member.id === x.id)!.id) && x.id !== m.id);
                if (next) setTimeout(() => setTab(next.id), 900);
              }} />
          ))}
          {allWatched && (() => {
            const v = verdictFor(fill);
            return (
              <div className={`rounded-2xl p-4 ring-1 ${v.match ? "bg-emerald-50 ring-emerald-200" : "bg-rose-50 ring-rose-200"}`} data-group-verdict={v.match ? "match" : "no_match"}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-lg font-bold ${v.match ? "text-emerald-900" : "text-rose-900"}`}>{v.match ? `${candidate.name.split(" ")[0]} is a match` : `${candidate.name.split(" ")[0]} isn't a match`}</span>
                  {fill.negotiations.map((n) => recs[n.id]?.result && <span key={n.id} className="flex items-center gap-1 text-xs text-slate-600">{n.member.name.split(" ")[0]}: <VerdictBadge status={recs[n.id].result!.status} /></span>)}
                </div>
                <p className="mt-1 text-sm text-slate-700">{v.summary}. Rule: {rule === "all" ? "everyone must agree" : "majority"}.</p>
                {v.match && (
                  <Link to={`/roombae/listings/${room.plan}`} className={`mt-3 inline-block rounded-full px-4 py-1.5 text-sm font-semibold ${R.primary}`}>Invite {candidate.name.split(" ")[0]} to {room.room_label}</Link>
                )}
              </div>
            );
          })()}
        </section>
      )}
    </div>
  );
}
