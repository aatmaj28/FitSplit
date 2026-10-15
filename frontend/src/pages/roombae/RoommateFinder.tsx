import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { LISTINGS, listing, money, type Listing } from "../../data/listings";
import { getPlan } from "../../data/plans";
import { demo, useDemo } from "../../data/store";
import { computeSplit } from "../../rentSplit";
import { startNegotiation, type Profile, type Verdict } from "../../roommates/api";
import { ME, pairId, swipeNegotiation } from "../../roommates/deck";
import { assignRooms, type Assignment } from "../../roommates/fit";
import { useNegotiationRecords, useProfiles, useScenarios } from "../../roommates/hooks";
import { Avatar, VerdictBadge } from "../../roommates/NegotiationView";
import { firstName } from "../../roommates/people";
import { ReplayDialog } from "../../roommates/ReplayDialog";
import { EmptyState, ErrorState, PageLoading } from "../ui";
import { FindTabs } from "./FindTabs";
import { R } from "./RoombaeLayout";

export { ME };

/** Listings with as many bedrooms as the group, and who would take which room within budget. */
function useGroupListings(people: Profile[]) {
  const [fits, setFits] = useState<{ l: Listing; result: ReturnType<typeof assignRooms> }[] | null>(null);
  const key = people.map((p) => p.id).join(",");
  useEffect(() => {
    let alive = true;
    setFits(null);
    const candidates = LISTINGS.filter((l) => l.beds === people.length);
    Promise.all(
      candidates.map(async (l) => {
        const { plan } = await getPlan(l.id);
        const rows = computeSplit(plan, { method: "fair", includeClosets: false, rent: l.rent }).rows;
        return { l, result: assignRooms(people, rows) };
      }),
    ).then((r) => alive && setFits(r.sort((a, b) => Number(b.result?.fits) - Number(a.result?.fits) || a.l.rent - b.l.rent)), () => alive && setFits([]));
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

const ok = (v: Verdict | null | undefined) => v === "strong" || v === "conditional";

/** Step 3 of Find roommates: pick matched roommates, check every pair, then the listings that fit the group. */
export default function RoommateFinder() {
  const [params, setParams] = useSearchParams();
  const target = listing(params.get("listing") ?? undefined);
  const navigate = useNavigate();
  const { profiles, offline, loading, error, retry } = useProfiles();
  const sc = useScenarios();
  const { swipes, group: saved } = useDemo();
  const [live, setLive] = useState<Record<string, string>>({}); // "a:b" -> live negotiation id
  const [liveError, setLiveError] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ id: string; a: Profile; b: Profile } | null>(null);

  const likes = swipes.filter((s) => s.dir === "like");
  const withParam = params.get("with");
  const selected = useMemo(() => {
    if (withParam !== null) return withParam.split(",").filter((id) => id && id !== ME);
    if (saved?.members.length) return saved.members.filter((id) => id !== ME);
    // default: your two latest matches (bundled verdicts)
    const matched = likes.filter((s) => ok(sc.data?.find.pairs.find((x) => x.id === swipeNegotiation(sc.data, ME, s))?.status));
    return matched.slice(-2).map((s) => s.id);
  }, [withParam, saved, likes, sc.data]);
  const pool = useMemo(() => [...new Set([...selected, ...likes.map((s) => s.id)])], [selected, likes]);
  const people = useMemo(() => [ME, ...selected].map((id) => profiles.find((p) => p.id === id)).filter((p): p is Profile => !!p), [selected, profiles]);

  // every pair in the group: Priya's from her swipes, the others' bundled (or started live here)
  const pairs = useMemo(() => {
    const out: { a: Profile; b: Profile; id: string | null; key: string }[] = [];
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const a = people[i], b = people[j], key = `${a.id}:${b.id}`;
        const swipe = a.id === ME ? likes.find((s) => s.id === b.id) : undefined;
        out.push({ a, b, key, id: (swipe && swipeNegotiation(sc.data, ME, swipe)) ?? pairId(sc.data, a.id, b.id) ?? live[key] ?? null });
      }
    }
    return out;
  }, [people, likes, sc.data, live]);
  const recs = useNegotiationRecords(pairs.map((p) => p.id).filter((x): x is string => !!x));
  const poolRecs = useNegotiationRecords(pool.map((id) => swipeNegotiation(sc.data, ME, likes.find((s) => s.id === id) ?? { id, dir: "like", at: "" }) ?? "").filter(Boolean));
  const fits = useGroupListings(people);

  if (loading || sc.loading) return <PageLoading label="Loading your group…" />;
  if (error || sc.error || !profiles.length) return <ErrorState title="Couldn't load your group" onRetry={retry}>{error ?? sc.error}</ErrorState>;

  const statusOf = (p: (typeof pairs)[number]) => (p.id ? recs[p.id]?.result?.status ?? (recs[p.id]?.status === "running" ? null : sc.data?.find.pairs.find((x) => x.id === p.id)?.status ?? null) : null);
  const myVerdict = (id: string) => {
    const nid = swipeNegotiation(sc.data, ME, likes.find((s) => s.id === id) ?? { id, dir: "like", at: "" });
    return nid ? poolRecs[nid]?.result?.status ?? sc.data?.find.pairs.find((x) => x.id === nid)?.status ?? null : null;
  };
  const setMembers = (ids: string[]) => {
    const next = new URLSearchParams(params);
    next.set("with", ids.join(","));
    setParams(next, { replace: true });
  };
  const toggle = (id: string) => setMembers(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const statuses = pairs.map(statusOf);
  const missing = pairs.filter((p, i) => !p.id || statuses[i] === null);
  const broken = pairs.filter((_, i) => statuses[i] === "incompatible");
  const groupOk = people.length > 1 && !missing.length && !broken.length;
  const save = (listingId: string) => {
    demo.setGroup(people.map((p) => p.id), listingId);
    navigate(`/roombae/listings/${listingId}`);
  };
  /** Open a listing; a matched group goes with it (names in the rent split, applicants on Apply). */
  const open = (listingId: string) => {
    if (groupOk) demo.setGroup(people.map((p) => p.id), listingId);
    navigate(`/roombae/listings/${listingId}`);
  };
  const talkLive = async (a: Profile, b: Profile) => {
    setLiveError(null);
    try {
      const rec = await startNegotiation(a.id, b.id);
      setLive((m) => ({ ...m, [`${a.id}:${b.id}`]: rec.id }));
    } catch {
      setLiveError("Couldn't start their conversation right now. Try again in a moment.");
    }
  };
  const preferred = target && fits?.find((f) => f.l.id === target.id);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Find a place together</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            Pick roommates from your matches. Every pair's clones have to agree, and only listings where each fair-split share fits each budget are shown.
            {target && <> Looking for a group for <span className="font-medium text-slate-700">{target.title}</span>.</>}
          </p>
        </div>
        <FindTabs />
      </div>

      {pool.length === 0 ? (
        <EmptyState title="No roommates picked yet" action={<Link to={`/roombae/discover${target ? `?listing=${target.id}` : ""}`} className={`rounded-full px-4 py-2 text-sm font-semibold ${R.primary}`}>Start swiping</Link>}>
          Swipe right in Discover; your matches show up here.
        </EmptyState>
      ) : (
        <>
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" aria-label="Roommates">
            <div className="text-sm font-semibold text-slate-800">Who's in</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="flex items-center gap-2 rounded-full bg-slate-100 py-1 pl-1 pr-3 text-sm font-medium text-slate-800">
                <Avatar id={ME} name={people[0]?.name ?? "You"} color={people[0]?.color ?? "#0d9488"} size={7} /> You
              </span>
              {pool.map((id) => {
                const p = profiles.find((x) => x.id === id);
                if (!p) return null;
                const v = myVerdict(id);
                const on = selected.includes(id);
                return (
                  <button key={id} type="button" onClick={() => toggle(id)} aria-pressed={on} disabled={!on && !ok(v)} data-member={id}
                    title={ok(v) ? undefined : "Your clones didn't match"}
                    className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-medium ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? "bg-emerald-50 text-emerald-900 ring-emerald-300" : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300"}`}>
                    <Avatar id={p.id} name={p.name} color={p.color} size={7} />
                    {firstName(p)}
                    {v && <VerdictBadge status={v} />}
                    <span aria-hidden className="text-xs">{on ? "✓" : "+"}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {people.length > 1 && (
            <section className={`space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ${groupOk ? "ring-emerald-200" : "ring-slate-200"}`} aria-label="Your group" data-group={people.map((p) => p.id).sort().join(",")}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className={`text-[11px] font-semibold uppercase tracking-wide ${groupOk ? "text-emerald-700" : "text-amber-700"}`}>{groupOk ? "Matched group" : "Not a group yet"}</div>
                  <h2 className="text-xl font-bold text-slate-900">{people.map(firstName).join(", ")}</h2>
                  <p className="text-sm text-slate-500">{people.length} beds · {pairs.length} {pairs.length === 1 ? "pair" : "pairs"} of clones checked</p>
                </div>
                <div className="flex -space-x-2">{people.map((p) => <span key={p.id} className="rounded-full ring-2 ring-white"><Avatar id={p.id} name={p.name} color={p.color} size={10} /></span>)}</div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {pairs.map((pair, i) => {
                  const st = statuses[i];
                  return (
                    <div key={pair.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm" data-pair={pair.key}>
                      <span className="text-slate-700">{firstName(pair.a)} & {firstName(pair.b)}</span>
                      <span className="flex items-center gap-1.5">
                        {st ? <VerdictBadge status={st} /> : pair.id ? <span className="text-xs text-slate-500">talking…</span> : (
                          <button type="button" disabled={offline} onClick={() => talkLive(pair.a, pair.b)} className="text-xs font-medium text-violet-700 disabled:text-slate-400" title={offline ? "Not available right now" : "Their clones talk now"}>
                            {offline ? "Not checked yet" : "Let their clones talk"}
                          </button>
                        )}
                        {pair.id && recs[pair.id]?.analysis && <span className="text-xs tabular-nums text-slate-500">{recs[pair.id].analysis!.scores.overall}</span>}
                        {pair.id && <button type="button" onClick={() => setReplay({ id: pair.id!, a: pair.a, b: pair.b })} className="text-xs font-medium text-violet-700 hover:text-violet-900">Watch</button>}
                      </span>
                    </div>
                  );
                })}
              </div>
              {liveError && <p className="text-xs text-amber-700">{liveError}</p>}
              {broken.length > 0 && <p className="text-sm text-rose-700">{broken.map((p) => `${firstName(p.a)} and ${firstName(p.b)}`).join(", ")} didn't click, so this isn't a group. Remove someone above.</p>}
              {missing.length > 0 && !broken.length && <p className="text-sm text-amber-700">{missing.map((p) => `${firstName(p.a)} and ${firstName(p.b)}`).join(", ")}: their clones haven't talked yet.</p>}

              <div>
                <h3 className="text-sm font-semibold text-slate-800">Listings that fit all {people.length} of you</h3>
                <p className="text-xs text-slate-500">Fair split of the real floor plan, each room matched to whoever can afford it.</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {(preferred && fits ? [preferred, ...fits.filter((f) => f !== preferred)] : fits ?? []).map(({ l, result }) => (
                    <div key={l.id} role="link" tabIndex={0} aria-label={`Open ${l.title}`} data-fit={l.id}
                      onClick={() => open(l.id)} onKeyDown={(e) => { if (e.key === "Enter") open(l.id); }}
                      className={`cursor-pointer rounded-2xl p-3.5 ring-1 transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e8553e] ${result?.fits ? "ring-emerald-200 hover:ring-emerald-300" : "ring-slate-200 hover:ring-slate-300"}`}>
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
                        <button type="button" onClick={(e) => { e.stopPropagation(); save(l.id); }} disabled={!groupOk} title={groupOk ? undefined : "Every pair has to match first"}
                          className={`mt-3 w-full rounded-full px-3 py-1.5 text-sm font-semibold disabled:opacity-40 ${R.primary}`}>
                          Save group & see it in 3D
                        </button>
                      )}
                      <Link to={`/roombae/listings/${l.id}`} onClick={(e) => { e.stopPropagation(); if (groupOk) demo.setGroup(people.map((p) => p.id), l.id); }}
                        className="mt-2 inline-block text-sm font-semibold text-[#d4452f] hover:underline">View listing →</Link>
                    </div>
                  ))}
                  {fits === null && <p className="text-sm text-slate-400">Checking listings…</p>}
                  {fits?.length === 0 && <p className="text-sm text-slate-500">No listing has {people.length} bedrooms right now. Try a smaller group.</p>}
                </div>
              </div>
            </section>
          )}
        </>
      )}
      {replay && <ReplayDialog id={replay.id} a={replay.a} b={replay.b} onClose={() => setReplay(null)} />}
    </div>
  );
}
