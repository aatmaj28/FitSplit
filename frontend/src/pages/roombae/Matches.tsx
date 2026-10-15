import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useDemo } from "../../data/store";
import type { Profile, Verdict } from "../../roommates/api";
import { ME, swipeNegotiation } from "../../roommates/deck";
import { useNegotiationRecords, useProfiles, useScenarios } from "../../roommates/hooks";
import { Avatar, ScoreBars, VerdictBadge } from "../../roommates/NegotiationView";
import { firstName } from "../../roommates/people";
import { ReplayDialog } from "../../roommates/ReplayDialog";
import { EmptyState, ErrorState, PageLoading } from "../ui";
import { FindTabs } from "./FindTabs";
import { R } from "./RoombaeLayout";

const DOT: Record<Verdict, string> = { strong: "bg-emerald-500", conditional: "bg-amber-500", incompatible: "bg-rose-500" };

/** My matches, after Tanvi's MyMatches page: verdict counts, an incompatible toggle, and each pair's scores and replay. */
export default function Matches() {
  const [params] = useSearchParams();
  const listingId = params.get("listing");
  const navigate = useNavigate();
  const { profiles, loading, error, retry } = useProfiles();
  const sc = useScenarios();
  const { swipes } = useDemo();
  const [showIncompatible, setShowIncompatible] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ id: string; other: Profile } | null>(null);
  const likes = useMemo(() => [...swipes].reverse().filter((s) => s.dir === "like").map((s) => ({ s, id: swipeNegotiation(sc.data, ME, s) })), [swipes, sc.data]);
  const recs = useNegotiationRecords(likes.map((l) => l.id).filter((x): x is string => !!x));
  const [picked, setPicked] = useState<Set<string> | null>(null);

  if (loading || sc.loading) return <PageLoading label="Loading your matches…" />;
  const me = profiles.find((p) => p.id === ME);
  if (error || sc.error || !me) return <ErrorState title="Couldn't load your matches" onRetry={retry}>{error ?? sc.error}</ErrorState>;

  const rows = likes.map(({ s, id }) => ({ p: profiles.find((x) => x.id === s.id), id, rec: id ? recs[id] : undefined })).filter((r): r is typeof r & { p: Profile } => !!r.p);
  const status = (r: (typeof rows)[number]) => r.rec?.result?.status ?? null;
  const counts = { strong: 0, conditional: 0, incompatible: 0 } as Record<Verdict, number>;
  rows.forEach((r) => { const st = status(r); if (st) counts[st]++; });
  const matched = rows.filter((r) => status(r) === "strong" || status(r) === "conditional");
  const group = picked ?? new Set(matched.slice(0, 2).map((r) => r.p.id));
  const visible = rows.filter((r) => showIncompatible || status(r) !== "incompatible");
  const toggle = (id: string) => {
    const next = new Set(group);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">My matches {rows.length > 0 && <span className="text-slate-400">({rows.length})</span>}</h1>
          <p className="max-w-2xl text-sm text-slate-500">Everyone you swiped right on, and what your clones decided. Pick who you'd like to live with, then find a place together.</p>
        </div>
        <FindTabs />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No matches yet" action={<Link to={`/roombae/discover${listingId ? `?listing=${listingId}` : ""}`} className={`rounded-full px-4 py-2 text-sm font-semibold ${R.primary}`}>Start swiping</Link>}>
          Swipe right on someone in Discover and your clones will talk.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-4 text-sm text-slate-600" data-counts={`${counts.strong},${counts.conditional},${counts.incompatible}`}>
              {(["strong", "conditional", "incompatible"] as Verdict[]).map((v) => (
                <span key={v} className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${DOT[v]}`} /> {counts[v]} {v}</span>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showIncompatible} onChange={(e) => setShowIncompatible(e.target.checked)} className="h-4 w-4 accent-[#e8553e]" />
              Show incompatible
            </label>
          </div>
          <ul className="space-y-3">
            {visible.map((r) => {
              const st = status(r);
              const ok = st === "strong" || st === "conditional";
              const expanded = open === r.p.id;
              return (
                <li key={r.p.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" data-match={r.p.id} data-status={st ?? "pending"}>
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar id={r.p.id} name={r.p.name} color={r.p.color} size={12} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-semibold text-slate-900">{r.p.name}</span>
                        {st ? <VerdictBadge status={st} /> : <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">{r.id ? "Talking…" : "Needs the backend"}</span>}
                        {r.rec?.analysis && <span className="text-sm tabular-nums text-slate-500">{r.rec.analysis.scores.overall}/100</span>}
                      </div>
                      <div className="text-xs text-slate-500">{r.p.program} · {r.p.school}</div>
                      {st === "conditional" && (r.rec?.result?.unresolved_topics.length ?? 0) > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {r.rec!.result!.unresolved_topics.map((t) => <span key={t} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200">{t}</span>)}
                        </div>
                      )}
                      {st === "incompatible" && r.rec?.result?.reason && <p className="mt-1 text-xs text-rose-700">{r.rec.result.reason}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {ok && (
                        <label className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${group.has(r.p.id) ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "text-slate-600 ring-slate-200"}`}>
                          <input type="checkbox" checked={group.has(r.p.id)} onChange={() => toggle(r.p.id)} className="h-3.5 w-3.5 accent-emerald-600" />
                          In my group
                        </label>
                      )}
                      {r.id && st && (
                        <button type="button" onClick={() => setReplay({ id: r.id!, other: r.p })} className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">Watch the conversation</button>
                      )}
                      {r.rec?.analysis && (
                        <button type="button" onClick={() => setOpen(expanded ? null : r.p.id)} aria-expanded={expanded} className="rounded-full px-2.5 py-1.5 text-xs text-slate-500 ring-1 ring-slate-200 hover:text-slate-800">
                          {expanded ? "Less ▲" : "Scores ▼"}
                        </button>
                      )}
                    </div>
                  </div>
                  {expanded && r.rec?.analysis && (
                    <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                      <ScoreBars scores={r.rec.analysis.scores} />
                      {r.rec.analysis.recommendation_summary && <p className="text-sm leading-relaxed text-slate-600">{r.rec.analysis.recommendation_summary}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {visible.length < rows.length && <p className="text-xs text-slate-400">{rows.length - visible.length} incompatible hidden.</p>}
          <div className="sticky bottom-[calc(var(--demo-bar-h,0px)+1rem)] z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-xl">
            <span className="flex items-center gap-2 text-sm">
              <span className="flex -space-x-2">
                {[me, ...matched.filter((r) => group.has(r.p.id)).map((r) => r.p)].map((p) => <span key={p.id} className="rounded-full ring-2 ring-slate-900"><Avatar id={p.id} name={p.name} color={p.color} size={7} /></span>)}
              </span>
              {group.size ? <>You, {matched.filter((r) => group.has(r.p.id)).map((r) => firstName(r.p)).join(" and ")}</> : "Pick at least one match"}
            </span>
            <button type="button" disabled={!group.size} onClick={() => navigate(`/roombae/roommates?with=${[...group].join(",")}${listingId ? `&listing=${listingId}` : ""}`)}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-orange-50 disabled:opacity-40">
              Find a place together →
            </button>
          </div>
        </>
      )}
      {replay && <ReplayDialog id={replay.id} a={me} b={replay.other} onClose={() => setReplay(null)} />}
    </div>
  );
}
