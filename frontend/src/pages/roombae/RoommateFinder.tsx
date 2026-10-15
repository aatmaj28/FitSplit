import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { LISTINGS, listing, money, type Listing } from "../../data/listings";
import { getPlan } from "../../data/plans";
import { demo } from "../../data/store";
import { computeSplit } from "../../rentSplit";
import { startNegotiation, type Profile, type Questionnaire, type Scenarios } from "../../roommates/api";
import { assignRooms, type Assignment } from "../../roommates/fit";
import { useNegotiationEvents, useNegotiationRecords, useProfiles, useQuestionnaire, useScenarios } from "../../roommates/hooks";
import { Avatar, NegotiationView, VerdictBadge } from "../../roommates/NegotiationView";
import { ProfileFacts, QuestionnaireForm } from "../../roommates/Questionnaire";
import { ErrorState, PageLoading } from "../ui";
import { R } from "./RoombaeLayout";

export const ME = "priya"; // the signed-in demo student

/** Listings with as many bedrooms as the group, and who would take which room within budget. */
function useGroupListings(people: Profile[]) {
  const [fits, setFits] = useState<{ l: Listing; result: ReturnType<typeof assignRooms> }[]>([]);
  const key = people.map((p) => p.id).join(",");
  useEffect(() => {
    let alive = true;
    const candidates = LISTINGS.filter((l) => l.beds === people.length);
    Promise.all(
      candidates.map(async (l) => {
        const { plan } = await getPlan(l.id);
        const rows = computeSplit(plan, { method: "fair", includeClosets: false, rent: l.rent }).rows;
        return { l, result: assignRooms(people, rows) };
      }),
    ).then((r) => alive && setFits(r.sort((a, b) => Number(b.result?.fits) - Number(a.result?.fits) || a.l.rent - b.l.rent)), () => {});
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return fits;
}

function Rooms({ assignment }: { assignment: Assignment[] }) {
  return (
    <ul className="space-y-0.5 text-xs">
      {assignment.map((a) => (
        <li key={a.person.id} className="flex justify-between gap-2">
          <span className="text-slate-600">{a.person.name.split(" ")[0]} → {a.label}</span>
          <span className={a.ok ? "tabular-nums text-slate-800" : "tabular-nums font-semibold text-rose-700"}>
            {money(a.row.share)}{a.over > 0 && (a.ok ? <span className="font-normal text-amber-700"> (flex +{money(a.over)})</span> : <span> over budget</span>)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function GroupResult({ scenarios, profiles, target }: { scenarios: Scenarios; profiles: Profile[]; target?: Listing }) {
  const navigate = useNavigate();
  const best = scenarios.find.groups[0];
  const people = useMemo(() => (best ? [ME, ...best.members.filter((m) => m !== ME)].map((id) => profiles.find((p) => p.id === id)).filter((p): p is Profile => !!p) : []), [best, profiles]);
  const recs = useNegotiationRecords(best?.pairs.map((p) => p.id) ?? []);
  const fits = useGroupListings(people);
  if (!best) return <ErrorState title="No group yet">None of the finished conversations formed a group.</ErrorState>;
  const name = (id: string) => profiles.find((p) => p.id === id)?.name.split(" ")[0] ?? id;
  const save = (listingId: string) => {
    demo.setGroup(people.map((p) => p.id), listingId);
    navigate(`/roombae/listings/${listingId}`);
  };
  const preferred = target && fits.find((f) => f.l.id === target.id);
  return (
    <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-emerald-200" aria-label="Your group" data-group={people.map((p) => p.id).join(",")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Matched group</div>
          <h2 className="text-xl font-bold text-slate-900">{people.map((p) => p.name.split(" ")[0]).join(", ")}</h2>
          <p className="text-sm text-slate-500">
            {people.length} beds · combined budget {money(best.budget_min)}–{money(best.budget_max)}/mo · every pair checked by their clones
          </p>
        </div>
        <div className="flex -space-x-2">{people.map((p) => <span key={p.id} className="rounded-full ring-2 ring-white"><Avatar name={p.name} color={p.color} size={10} /></span>)}</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {best.pairs.map((pair) => (
          <div key={pair.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-700">{name(pair.a)} & {name(pair.b)}</span>
            <span className="flex items-center gap-1.5">
              <VerdictBadge status={pair.status} />
              {recs[pair.id]?.analysis && <span className="text-xs tabular-nums text-slate-500">{recs[pair.id].analysis!.scores.overall}</span>}
            </span>
          </div>
        ))}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Listings that fit all {people.length} of you</h3>
        <p className="text-xs text-slate-500">Fair split of the real floor plan, each room matched to whoever can afford it.</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {(preferred ? [preferred, ...fits.filter((f) => f !== preferred)] : fits).map(({ l, result }) => (
            <div key={l.id} className={`rounded-2xl p-3.5 ring-1 ${result?.fits ? "ring-emerald-200" : "ring-slate-200"}`} data-fit={l.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900">{l.title}</div>
                  <div className="text-xs text-slate-500">{money(l.rent)}/mo · {l.sqft.toLocaleString()} sq ft</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${result?.fits ? "bg-emerald-100 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
                  {result?.fits ? "Fits every budget" : "Over someone's budget"}
                </span>
              </div>
              {result && <div className="mt-2"><Rooms assignment={result.assignment} /></div>}
              {result?.fits && (
                <button type="button" onClick={() => save(l.id)} className={`mt-3 w-full rounded-full px-3 py-1.5 text-sm font-semibold ${R.primary}`}>
                  Save group & see it in 3D
                </button>
              )}
            </div>
          ))}
          {!fits.length && <p className="text-sm text-slate-400">Checking listings…</p>}
        </div>
      </div>
    </section>
  );
}

export default function RoommateFinder() {
  const [params] = useSearchParams();
  const target = listing(params.get("listing") ?? undefined);
  const { profiles, offline, loading, error, retry } = useProfiles();
  const sc = useScenarios();
  const schema = useQuestionnaire();
  const me = profiles.find((p) => p.id === ME);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Questionnaire | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [live, setLive] = useState<Record<string, string>>({}); // candidate -> live negotiation id
  const [liveError, setLiveError] = useState<string | null>(null);
  const [showGroup, setShowGroup] = useState(false);
  const { events, error: streamError } = useNegotiationEvents(activeId);

  const mine = useMemo(
    () => (sc.data?.find.pairs ?? []).filter((p) => p.a === ME || p.b === ME).map((p) => ({ ...p, other: p.a === ME ? p.b : p.a })),
    [sc.data],
  );
  const others = profiles.filter((p) => p.id !== ME && !mine.some((m) => m.other === p.id));
  const done = mine.length > 0 && mine.every((m) => watched.has(m.id));
  useEffect(() => {
    if (done) setShowGroup(true);
  }, [done]);

  if (loading || sc.loading) return <PageLoading label="Loading students…" />;
  if (error || sc.error || !me) return <ErrorState title="Couldn't load the roommate finder" onRetry={retry}>{error ?? sc.error ?? "Demo profile missing"}</ErrorState>;

  const byId = (id: string) => profiles.find((p) => p.id === id)!;
  const active = mine.find((m) => m.id === activeId);
  const activeOther = active ? byId(active.other) : Object.entries(live).find(([, id]) => id === activeId)?.[0];
  const otherProfile = typeof activeOther === "string" ? byId(activeOther) : activeOther;
  const meetAll = () => {
    setQueue(mine.slice(1).map((m) => m.id));
    setActiveId(mine[0].id);
  };
  const onDone = () => {
    if (activeId) setWatched((w) => new Set(w).add(activeId));
    if (queue.length) {
      setTimeout(() => {
        setActiveId(queue[0]);
        setQueue((q) => q.slice(1));
      }, 900);
    }
  };
  const goLive = async (p: Profile) => {
    setLiveError(null);
    try {
      const rec = await startNegotiation(ME, p.id);
      setLive((l) => ({ ...l, [p.id]: rec.id }));
      setActiveId(rec.id);
    } catch {
      setLiveError("Live negotiations need the backend (and a free model quota). The bundled matches still work offline.");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Find roommates</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            Your AI clone talks to other students' clones in four phases, about budget, sleep, guests, cleaning and dealbreakers. You only meet the ones who click.
            {target && <> Looking for a group for <span className="font-medium text-slate-700">{target.title}</span>.</>}
          </p>
        </div>
        <div className="inline-flex rounded-full bg-white p-1 text-sm ring-1 ring-slate-200" role="group" aria-label="Mode">
          <span className={`rounded-full px-3 py-1 font-medium ${R.soft}`} aria-current="page">People first</span>
          <Link to="/roombae/fill-room" className="rounded-full px-3 py-1 text-slate-600 hover:text-slate-900">Apartment first</Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-3">
              <Avatar name={me.name} color={me.color} size={10} />
              <div>
                <div className="font-semibold text-slate-900">{me.name} <span className="text-xs font-normal text-slate-400">(you)</span></div>
                <div className="text-xs text-slate-500">{me.program}, {me.school}</div>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-600">{me.bio}</p>
            <div className="mt-2"><ProfileFacts p={draft ? { ...me, questionnaire: draft } : me} /></div>
            <button type="button" onClick={() => { setEditing((e) => !e); setDraft((d) => d ?? me.questionnaire); }} className="mt-3 text-xs font-medium text-violet-700 hover:text-violet-900">
              {editing ? "Hide questionnaire" : "View / edit questionnaire (7 sections)"}
            </button>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">Your clone's matches</h2>
              <button type="button" onClick={meetAll} className={`rounded-full px-3 py-1 text-xs font-semibold ${R.primary}`}>Meet all</button>
            </div>
            <ul className="mt-2 space-y-1.5">
              {mine.map((m) => {
                const p = byId(m.other);
                return (
                  <li key={m.id}>
                    <button type="button" onClick={() => { setQueue([]); setActiveId(m.id); }} aria-pressed={activeId === m.id}
                      className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors ${activeId === m.id ? "bg-violet-50 ring-1 ring-violet-200" : "hover:bg-slate-50"}`}>
                      <Avatar name={p.name} color={p.color} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">{p.name}</span>
                        <span className="block truncate text-[11px] text-slate-500">{p.school}</span>
                      </span>
                      {watched.has(m.id) && m.status ? <VerdictBadge status={m.status} /> : <span className="text-[11px] text-slate-400">{activeId === m.id ? "talking…" : "ready"}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            {others.length > 0 && (
              <>
                <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">More students</div>
                <ul className="mt-1 space-y-1">
                  {others.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 px-2 py-1">
                      <Avatar name={p.name} color={p.color} size={6} />
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{p.name} · {p.school}</span>
                      {live[p.id] ? (
                        <button type="button" onClick={() => setActiveId(live[p.id])} className="text-[11px] font-medium text-violet-700">View</button>
                      ) : (
                        <button type="button" disabled={offline} onClick={() => goLive(p)} title={offline ? "Needs the backend" : "Run a live negotiation now"}
                          className="text-[11px] font-medium text-violet-700 disabled:text-slate-300">Live chat</button>
                      )}
                    </li>
                  ))}
                </ul>
                {liveError && <p className="mt-1 text-[11px] text-amber-700">{liveError}</p>}
              </>
            )}
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          {editing && schema.data && draft && (
            <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
              <p className="mb-2 text-xs text-slate-500">This is what your clone knows about you. The bundled matches were negotiated with these answers; changing them makes your clone negotiate again (live, needs the backend).</p>
              <QuestionnaireForm schema={schema.data} value={draft} onChange={setDraft} />
            </div>
          )}
          <div className="rounded-2xl bg-[#fbfaff] p-4 ring-1 ring-violet-100">
            {activeId && otherProfile ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <Avatar name={me.name} color={me.color} />
                  <span className="font-medium text-slate-800">{me.name.split(" ")[0]}'s clone</span>
                  <span className="text-slate-400">and</span>
                  <Avatar name={otherProfile.name} color={otherProfile.color} />
                  <span className="font-medium text-slate-800">{otherProfile.name.split(" ")[0]}'s clone</span>
                  {queue.length > 0 && <span className="ml-auto text-xs text-slate-400">{queue.length} more after this</span>}
                </div>
                {streamError ? (
                  <ErrorState title="Can't show this conversation">{streamError}</ErrorState>
                ) : events.length ? (
                  <NegotiationView key={activeId} events={events} animate={!watched.has(activeId)} a={{ name: me.name, color: me.color }} b={{ name: otherProfile.name, color: otherProfile.color }} onDone={onDone} />
                ) : (
                  <PageLoading label="Connecting the clones…" />
                )}
              </>
            ) : (
              <div className="px-2 py-10 text-center">
                <div className="text-sm font-semibold text-slate-700">Your clone is ready</div>
                <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">It will meet {mine.length} students who live near Fenway and fit your budget. Watch the conversations play out, or skip to the result.</p>
                <div className="mt-4 flex justify-center gap-2">
                  <button type="button" onClick={meetAll} className={`rounded-full px-4 py-2 text-sm font-semibold ${R.primary}`}>Meet all matches</button>
                  <button type="button" onClick={() => setShowGroup(true)} className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">Skip to the group</button>
                </div>
              </div>
            )}
          </div>
          {!showGroup && activeId && (
            <button type="button" onClick={() => setShowGroup(true)} className="text-sm font-medium text-slate-500 hover:text-slate-800">Skip to the group →</button>
          )}
        </section>
      </div>

      {showGroup && sc.data && <GroupResult scenarios={sc.data} profiles={profiles} target={target} />}
      <p className="text-xs text-slate-400">
        Roommate engine: a port of Tanvi's AI Roommate Finder (questionnaire, ACP clone protocol, four-phase negotiation, compatibility analysis). Students are sample profiles.
      </p>
    </div>
  );
}
