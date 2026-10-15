import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useDemo } from "../../data/store";
import { loadHouseRules, type HouseRules, type Profile, type Verdict } from "../../roommates/api";
import { ME, pairId, swipeNegotiation } from "../../roommates/deck";
import { chatTime, useGroupChat } from "../../roommates/groupChat";
import { useNegotiationRecords, useProfiles, useScenarios } from "../../roommates/hooks";
import { Avatar, VerdictBadge } from "../../roommates/NegotiationView";
import { firstName, tint } from "../../roommates/people";
import { ReplayDialog } from "../../roommates/ReplayDialog";
import { EmptyState, ErrorState, PageLoading } from "../ui";
import { FindTabs } from "./FindTabs";
import { R } from "./RoombaeLayout";

const TOPIC_ICON: Record<HouseRules["rules"][number]["topic"], string> = {
  "quiet hours": "🌙", guests: "🎉", chores: "🧽", kitchen: "🍳", costs: "💸", other: "🏠",
};

/** Step 4 of Find roommates: the house rules the clones agreed on, the roommates' own chat, and each pair's replay. */
export default function GroupChat() {
  const [params] = useSearchParams();
  const { profiles, loading, error, retry } = useProfiles();
  const sc = useScenarios();
  const { group, swipes } = useDemo();
  const [replay, setReplay] = useState<{ id: string; a: Profile; b: Profile } | null>(null);
  const [rules, setRules] = useState<HouseRules | null>(null);
  const [rulesError, setRulesError] = useState(false);
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);

  // who's in: ?with=..., else the saved group, else the best matched group
  const members = useMemo(() => {
    const w = params.get("with");
    const ids = w ? w.split(",") : group?.members.length ? group.members : (sc.data?.find.groups[0]?.members ?? []);
    return [ME, ...ids.filter((id) => id && id !== ME)];
  }, [params, group, sc.data]);
  const people = members.map((id) => profiles.find((p) => p.id === id)).filter((p): p is Profile => !!p);
  const key = [...members].sort().join("+");
  const pairs = useMemo(() => {
    const out: { a: Profile; b: Profile; id: string | null }[] = [];
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const a = people[i], b = people[j];
        const swipe = a.id === ME ? swipes.find((s) => s.id === b.id) : undefined;
        out.push({ a, b, id: (swipe && swipeNegotiation(sc.data, ME, swipe)) ?? pairId(sc.data, a.id, b.id) });
      }
    }
    return out;
  }, [people.map((p) => p.id).join(","), swipes, sc.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const recs = useNegotiationRecords(pairs.map((p) => p.id).filter((x): x is string => !!x));
  const ids = pairs.map((p) => p.id);
  const ready = people.length > 1 && ids.every(Boolean);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    setRules(null);
    setRulesError(false);
    loadHouseRules(members, ids as string[]).then((r) => alive && setRules(r), () => alive && setRulesError(true));
    return () => {
      alive = false;
    };
  }, [key, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const [messages, send] = useGroupChat(key);
  useEffect(() => {
    end.current?.parentElement?.scrollTo({ top: end.current.parentElement.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  if (loading || sc.loading) return <PageLoading label="Opening your group chat…" />;
  if (error || sc.error) return <ErrorState title="Couldn't open the group chat" onRetry={retry}>{error ?? sc.error}</ErrorState>;
  const by = (id: string) => profiles.find((p) => p.id === id);
  const keep = params.get("listing") ? `?listing=${params.get("listing")}` : "";
  const status = (id: string | null): Verdict | null => (id ? recs[id]?.result?.status ?? sc.data?.find.pairs.find((p) => p.id === id)?.status ?? null : null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Group chat</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            {people.length > 1 ? <>{people.map(firstName).join(", ")}: what your clones agreed on, and a place to talk it through.</> : "Pick your roommates first."}
          </p>
        </div>
        <FindTabs />
      </div>

      {people.length < 2 ? (
        <EmptyState title="No group yet" action={<Link to={`/roombae/roommates${keep}`} className={`rounded-full px-4 py-2 text-sm font-semibold ${R.primary}`}>Find a place together</Link>}>
          Choose who you'd like to live with, and your group chat opens here.
        </EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="flex min-h-[32rem] flex-col overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200" aria-label="Group chat">
            {/* pinned: the house rules */}
            <div className="border-b border-amber-100 bg-amber-50/70 px-4 py-3" data-house-rules>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
                <span aria-hidden>📌</span> House rules your clones agreed on
              </div>
              {rules ? (
                <>
                  <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {rules.rules.map((r) => (
                      <li key={r.topic + r.text} className="flex gap-2 text-[13px] leading-snug text-slate-700">
                        <span aria-hidden>{TOPIC_ICON[r.topic]}</span>
                        <span><span className="font-semibold capitalize text-slate-900">{r.topic}:</span> {r.text}</span>
                      </li>
                    ))}
                  </ul>
                  {rules.open.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-medium text-amber-900">Still open:</span>
                      {rules.open.map((o) => <span key={o} className="rounded-full bg-white px-2 py-0.5 text-amber-900 ring-1 ring-amber-200">{o}</span>)}
                    </div>
                  )}
                </>
              ) : rulesError || !ready ? (
                <p className="mt-1 text-[13px] text-slate-600">{ready ? "Your clones' house rules will appear here shortly." : "Once every pair's clones have talked, their house rules appear here."}</p>
              ) : (
                <p className="mt-1 text-[13px] text-slate-500">Gathering what your clones agreed on…</p>
              )}
            </div>

            {/* the roommates' own chat */}
            <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 px-4 py-4" data-chat-log>
              {messages.map((m, i) => {
                const p = by(m.from);
                const mine = m.from === ME;
                return (
                  <div key={i} className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`} data-chat-msg={m.from}>
                    {p && <Avatar id={p.id} name={p.name} color={p.color} size={8} />}
                    <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[14px] leading-snug shadow-sm ${mine ? "rounded-br-md bg-[#e8553e] text-white" : "rounded-bl-md bg-white text-slate-800 ring-1 ring-slate-200"}`}>
                      {!mine && p && <div className="mb-0.5 text-[11px] font-semibold" style={{ color: p.color }}>{firstName(p)}</div>}
                      <p className="whitespace-pre-wrap break-words">{m.text}</p>
                      <div className={`mt-1 text-right text-[10px] ${mine ? "text-white/70" : "text-slate-400"}`}>{chatTime(m.at)}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={end} />
            </div>
            <form className="flex gap-2 border-t border-slate-200 bg-white p-3"
              onSubmit={(e) => {
                e.preventDefault();
                send(ME, draft);
                setDraft("");
              }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Message ${people.slice(1).map(firstName).join(" and ")}`} aria-label="Message"
                className="min-w-0 flex-1 rounded-full bg-slate-100 px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#e8553e]/40" />
              <button type="submit" disabled={!draft.trim()} className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40 ${R.primary}`}>Send</button>
            </form>
          </section>

          <aside className="space-y-4">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="text-sm font-semibold text-slate-800">In this group</div>
              <ul className="mt-2 space-y-2">
                {people.map((p) => (
                  <li key={p.id} className="flex items-center gap-2.5 text-sm">
                    <span className="rounded-full p-0.5" style={{ background: tint(p.color, 0.7) }}><Avatar id={p.id} name={p.name} color={p.color} size={8} /></span>
                    <span className="min-w-0">
                      <span className="block font-medium text-slate-900">{p.name}{p.id === ME && <span className="font-normal text-slate-400"> (you)</span>}</span>
                      <span className="block truncate text-xs text-slate-500">{p.program} · {p.school}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" data-pair-replays>
              <div className="text-sm font-semibold text-slate-800">View each pair's clone conversation</div>
              <ul className="mt-2 space-y-1.5">
                {pairs.map((pair) => (
                  <li key={pair.a.id + pair.b.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-700">{firstName(pair.a)} & {firstName(pair.b)}</span>
                    <span className="flex items-center gap-2">
                      {status(pair.id) && <VerdictBadge status={status(pair.id)!} />}
                      {pair.id ? (
                        <button type="button" onClick={() => setReplay({ id: pair.id!, a: pair.a, b: pair.b })} className="text-xs font-semibold text-violet-700 hover:text-violet-900">Watch →</button>
                      ) : (
                        <span className="text-xs text-slate-400">not yet</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      )}
      {replay && <ReplayDialog id={replay.id} a={replay.a} b={replay.b} onClose={() => setReplay(null)} />}
    </div>
  );
}
