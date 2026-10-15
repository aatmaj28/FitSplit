import { animate, motion, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { listing as findListing } from "../../data/listings";
import { demo, useDemo } from "../../data/store";
import { parseAcp } from "../../roommates/acp";
import { startNegotiation, type NegotiationEvent, type NegotiationMessage, type Profile, type Scenarios } from "../../roommates/api";
import { discoverDeck, ME, noClickReason, pairId, topScores, type HiddenReason, type SwipeDir } from "../../roommates/deck";
import { useNegotiationEvents, useProfiles, useScenarios } from "../../roommates/hooks";
import { Avatar, VerdictBadge } from "../../roommates/NegotiationView";
import { avatarUrl, cardFacts, firstName, funTags, tint, topPriorities } from "../../roommates/people";
import { ProfileFacts } from "../../roommates/Questionnaire";
import { ReplayDialog } from "../../roommates/ReplayDialog";
import { ErrorState, PageLoading } from "../ui";
import { FindTabs } from "./FindTabs";
import { R } from "./RoombaeLayout";

// ----------------------------------------------------------------------------- the card

function CardFace({ p, like, nope }: { p: Profile; like?: MotionValue<number>; nope?: MotionValue<number> }) {
  const facts = cardFacts(p);
  const tags = funTags(p);
  const cares = topPriorities(p);
  return (
    <article className="flex h-full select-none flex-col overflow-hidden rounded-[1.75rem] bg-white shadow-xl shadow-slate-900/10 ring-1 ring-slate-200" aria-label={`${p.name}, ${p.program}, ${p.school}`}>
      <div className="relative h-[52%] shrink-0 overflow-hidden" style={{ background: tint(p.color, 0.74) }}>
        <img src={avatarUrl(p.id)} alt="" draggable={false} className="pointer-events-none absolute inset-x-0 -bottom-2 mx-auto h-[96%] object-contain" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/80 via-slate-950/35 to-transparent px-5 pb-3 pt-12 text-white">
          <h2 className="text-2xl font-bold leading-tight tracking-tight">{p.name}</h2>
          <p className="text-sm text-white/85">{p.program} · {p.school}</p>
          <p className="text-xs text-white/70">From {p.hometown}</p>
        </div>
        {like && <motion.span style={{ opacity: like }} className="absolute left-5 top-5 -rotate-12 rounded-lg border-4 border-emerald-500 bg-white/70 px-2 text-2xl font-black uppercase tracking-wider text-emerald-600">Like</motion.span>}
        {nope && <motion.span style={{ opacity: nope }} className="absolute right-5 top-5 rotate-12 rounded-lg border-4 border-rose-500 bg-white/70 px-2 text-2xl font-black uppercase tracking-wider text-rose-600">Nope</motion.span>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
        <dl className="grid grid-cols-3 gap-x-2 gap-y-2 text-xs">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{f.label}</dt>
              <dd className="truncate font-semibold text-slate-800">{f.value}</dd>
            </div>
          ))}
        </dl>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => <span key={t} className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: tint(p.color, 0.86), color: p.color }}>{t}</span>)}
          </div>
        )}
        <p className="line-clamp-3 text-[13px] leading-snug text-slate-600">{p.bio}</p>
        {cares.length > 0 && (
          <p className="mt-auto text-xs text-slate-500"><span className="font-semibold text-slate-700">Cares about:</span> {cares.join(" · ")}</p>
        )}
      </div>
    </article>
  );
}

interface CardHandle {
  swipe: (dir: SwipeDir) => void;
}

/** The top card: drag it, or swipe() it from the buttons and arrow keys. */
const SwipeCard = forwardRef<CardHandle, { p: Profile; onSwiped: (dir: SwipeDir) => void }>(function SwipeCard({ p, onSwiped }, ref) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-260, 0, 260], [-16, 0, 16]);
  const like = useTransform(x, [24, 110], [0, 1]);
  const nope = useTransform(x, [-110, -24], [1, 0]);
  const gone = useRef(false);
  const fly = (dir: SwipeDir) => {
    if (gone.current) return;
    gone.current = true;
    const to = (dir === "like" ? 1 : -1) * (Math.max(window.innerWidth, 800) / 2 + 360);
    animate(x, to, { duration: 0.34, ease: [0.4, 0, 1, 1] }).then(() => onSwiped(dir));
  };
  useImperativeHandle(ref, () => ({ swipe: fly }));
  return (
    <motion.div
      className="absolute inset-0 z-20 cursor-grab active:cursor-grabbing"
      style={{ x, rotate }}
      initial={{ scale: 0.95, y: 14 }}
      animate={{ scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      drag="x"
      dragMomentum={false}
      onDragEnd={(_, info) => {
        if (info.offset.x > 110 || info.velocity.x > 700) fly("like");
        else if (info.offset.x < -110 || info.velocity.x < -700) fly("pass");
        else animate(x, 0, { type: "spring", stiffness: 420, damping: 26 });
      }}
      data-card={p.id}
    >
      <CardFace p={p} like={like} nope={nope} />
    </motion.div>
  );
});

// ----------------------------------------------------------------------------- after a like

/** "Ananya's clone shares sleep, cleanliness, guests": what one ACP message was about. */
function talkLine(m: NegotiationMessage): string {
  if (m.say) return `${m.speaker.split(" ")[0]}: ${m.say}`;
  const who = `${m.speaker.split(" ")[0]}'s clone`;
  const st = parseAcp(m.message).parts.flatMap((x) => (x.kind === "statement" ? [x] : []));
  // what the message is about: its first statement that isn't a (often premature) verdict
  const main = st.find((x) => x.type !== "VRD") ?? st[0];
  if (!main) return `${who} is thinking it over`;
  const topics = [...new Set(main.fields.map((f) => f.label).filter((l) => l && !["reason", "open topics"].includes(l)))].slice(0, 3).join(", ");
  switch (main.type) {
    case "HI": return `${who} says hi: budget, move-in, dealbreakers`;
    case "PFR": return `${who} shares ${topics || "preferences"}`;
    case "CNF": return `${who} flags ${topics || "a friction point"}`;
    case "FLX": return `${who} offers a middle ground on ${topics || "the details"}`;
    default: return `${who} gives a verdict: ${(main.value || "").toLowerCase() || "decided"}`;
  }
}

type Complete = Extract<NegotiationEvent, { type: "complete" }>;

/** Plays the clones' conversation fast (typing, then one line per message), then hands over the verdict. */
function ClonesTalking({ me, other, events, onDone, onSkip, onLeave }: { me: Profile; other: Profile; events: NegotiationEvent[]; onDone: () => void; onSkip: () => void; onLeave: () => void }) {
  const msgs = events.filter((e): e is Extract<NegotiationEvent, { type: "agent_message" }> => e.type === "agent_message").map((e) => e.data);
  const complete = events.some((e) => e.type === "complete");
  const [n, setN] = useState(0);
  useEffect(() => {
    if (n < msgs.length) {
      const t = setTimeout(() => setN((k) => k + 1), n === 0 ? 650 : 260);
      return () => clearTimeout(t);
    }
    if (complete) {
      const t = setTimeout(onDone, 600);
      return () => clearTimeout(t);
    }
  }, [n, msgs.length, complete]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = Math.max(msgs.length, 13);
  const line = n > 0 ? talkLine(msgs[n - 1]) : "Opening the chat…";
  return (
    <div className="flex flex-col items-center text-center" data-flow="talking">
      <div className="flex items-center gap-3">
        <span className="rounded-full ring-4 ring-white/40"><Avatar id={me.id} name={me.name} color={me.color} size={16} /></span>
        <span className="flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => <span key={i} className="h-2.5 w-2.5 animate-bounce rounded-full bg-white" style={{ animationDelay: `${i * 0.15}s` }} />)}
        </span>
        <span className="rounded-full ring-4 ring-white/40"><Avatar id={other.id} name={other.name} color={other.color} size={16} /></span>
      </div>
      <h2 className="mt-5 text-2xl font-bold text-white">Your clones are talking…</h2>
      <p className="mt-1 text-sm text-white/80">{firstName(me)}'s clone and {firstName(other)}'s clone, about budget, sleep, guests and dealbreakers</p>
      <p className="mt-5 min-h-[2.5rem] max-w-sm text-sm font-medium text-white" aria-live="polite" key={n}>{line}</p>
      <div className="mt-3 h-1.5 w-56 overflow-hidden rounded-full bg-white/25" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={n} aria-label="Conversation progress">
        <div className="h-full rounded-full bg-white transition-[width] duration-200" style={{ width: `${(n / total) * 100}%` }} />
      </div>
      <button type="button" onClick={onSkip} disabled={!complete} className="mt-5 rounded-full px-3 py-1 text-xs font-medium text-white/80 ring-1 ring-white/40 hover:text-white disabled:opacity-40">
        {complete ? "Skip to the verdict" : "Still talking…"}
      </button>
      {!complete && (
        <button type="button" onClick={onLeave} className="mt-3 text-xs text-white/75 underline-offset-2 hover:text-white hover:underline">
          Keep swiping; the verdict will be in My matches
        </button>
      )}
    </div>
  );
}

function MatchCard({ me, other, done, onReplay, onGroup, onClose }: { me: Profile; other: Profile; done: Complete; onReplay: () => void; onGroup: () => void; onClose: () => void }) {
  const tops = topScores(done);
  const summary = (done.analysis?.recommendation_summary || done.result.reason || "").split(/(?<=[.!?])\s/)[0];
  return (
    <div className="flex flex-col items-center text-center" data-flow="match" data-verdict={done.result.status}>
      <div className="relative flex items-center">
        <span className="-rotate-6 rounded-full ring-4 ring-white"><Avatar id={me.id} name={me.name} color={me.color} size={24} /></span>
        <span className="z-10 -mx-4 grid h-12 w-12 place-items-center rounded-full bg-white text-2xl text-rose-500 shadow-lg" aria-hidden>♥</span>
        <span className="rotate-6 rounded-full ring-4 ring-white"><Avatar id={other.id} name={other.name} color={other.color} size={24} /></span>
      </div>
      <h2 className="mt-5 text-4xl font-black tracking-tight text-white drop-shadow">It's a match!</h2>
      <p className="mt-1 text-sm text-white/90">Your clone and {firstName(other)}'s clone think you'd live well together.</p>
      <div className="mt-4 w-full max-w-sm space-y-3 rounded-2xl bg-white p-4 text-left shadow-xl">
        <div className="flex flex-wrap items-center gap-2">
          <VerdictBadge status={done.result.status} className="text-sm" />
          {done.analysis && <span className="text-sm text-slate-500"><span className="font-semibold text-slate-900">{done.analysis.scores.overall}</span>/100</span>}
        </div>
        {tops.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {tops.map((t) => (
              <div key={t.label} className="rounded-xl bg-slate-50 px-2 py-1.5 text-center">
                <div className="text-lg font-bold tabular-nums text-slate-900">{t.value}</div>
                <div className="text-[11px] text-slate-500">{t.label}</div>
              </div>
            ))}
          </div>
        )}
        {done.result.status === "conditional" && done.result.unresolved_topics.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">Still to agree on:</span>
            {done.result.unresolved_topics.map((t) => <span key={t} className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800 ring-1 ring-amber-200">{t}</span>)}
          </div>
        )}
        {summary && <p className="text-sm leading-snug text-slate-600">{summary}</p>}
      </div>
      <div className="mt-5 flex w-full max-w-sm flex-col gap-2 sm:flex-row">
        <button type="button" onClick={onReplay} className="flex-1 rounded-full bg-white/15 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/60 hover:bg-white/25">Watch the conversation</button>
        <button type="button" onClick={onGroup} className="flex-1 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-[#d4452f] shadow hover:bg-orange-50">Find a place together</button>
      </div>
      <button type="button" onClick={onClose} className="mt-3 text-sm font-medium text-white/85 hover:text-white">Keep swiping</button>
    </div>
  );
}

function NoClickCard({ me, other, done, onReplay, onClose }: { me: Profile; other: Profile; done: Complete; onReplay: () => void; onClose: () => void }) {
  return (
    <div className="flex flex-col items-center text-center" data-flow="noclick" data-verdict={done.result.status}>
      <div className="relative flex items-center gap-10">
        <span className="-rotate-12 rounded-full opacity-90 ring-4 ring-white/70"><Avatar id={me.id} name={me.name} color={me.color} size={20} /></span>
        <span className="absolute left-1/2 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-lg shadow" aria-hidden>🙃</span>
        <span className="rotate-12 rounded-full opacity-90 ring-4 ring-white/70"><Avatar id={other.id} name={other.name} color={other.color} size={20} /></span>
      </div>
      <h2 className="mt-5 text-3xl font-bold tracking-tight text-white">Your clones didn't click</h2>
      <p className="mt-3 max-w-sm rounded-2xl bg-white/95 px-4 py-3 text-sm font-medium text-slate-800 shadow-lg" data-noclick-reason>{noClickReason(me, other, done)}</p>
      <p className="mt-2 max-w-sm text-xs text-white/75">No awkward first call needed. Plenty more students to meet.</p>
      <div className="mt-5 flex w-full max-w-sm flex-col gap-2 sm:flex-row">
        <button type="button" onClick={onReplay} className="flex-1 rounded-full bg-white/15 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/60 hover:bg-white/25">See why</button>
        <button type="button" onClick={onClose} className="flex-1 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow hover:bg-slate-50">Keep swiping</button>
      </div>
    </div>
  );
}

/** Full-screen sheet for the steps after a like: talking, then the match or "didn't click". */
function AfterLike({ me, other, negId, failed, onReplay, onGroup, onClose }: {
  me: Profile; other: Profile; negId: string | null; failed: boolean; onReplay: (id: string) => void; onGroup: (done: Complete) => void; onClose: () => void;
}) {
  const { events, error } = useNegotiationEvents(negId);
  const [stage, setStage] = useState<"talking" | "result">("talking");
  const done = events.find((e): e is Complete => e.type === "complete");
  const match = done && done.result.status !== "incompatible";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const bg = stage === "result" && done ? (match ? "from-[#e8553e] via-rose-500 to-violet-600" : "from-slate-700 via-slate-600 to-slate-800") : "from-violet-600 via-fuchsia-600 to-[#e8553e]";
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gradient-to-br p-5 ${bg}`} role="dialog" aria-modal="true" aria-label={`You and ${firstName(other)}`}>
      <motion.div className="w-full max-w-md py-8" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 26 }} key={stage}>
        {failed || error ? (
          <div className="text-center text-white" data-flow="offline">
            <h2 className="text-2xl font-bold">Your like is saved</h2>
            <p className="mt-2 text-sm text-white/85">{firstName(other)}'s clone isn't in the bundled demo, and a live conversation needs the backend (and a free model quota). It will show in My matches once it runs.</p>
            <button type="button" onClick={onClose} className="mt-5 rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-800">Keep swiping</button>
          </div>
        ) : stage === "talking" || !done ? (
          <ClonesTalking me={me} other={other} events={events} onDone={() => setStage("result")} onSkip={() => setStage("result")} onLeave={onClose} />
        ) : match ? (
          <MatchCard me={me} other={other} done={done} onReplay={() => negId && onReplay(negId)} onGroup={() => onGroup(done)} onClose={onClose} />
        ) : (
          <NoClickCard me={me} other={other} done={done} onReplay={() => negId && onReplay(negId)} onClose={onClose} />
        )}
      </motion.div>
    </div>
  );
}

// ----------------------------------------------------------------------------- page

const HIDDEN_LABEL: Record<Exclude<HiddenReason, "seen">, string> = {
  hosting: "already has a place (in Fill a room)",
  location: "lives in another city",
  gender: "wants a same-gender roommate",
};

/** Matched likes so far, for "Find a place together" (bundled verdicts, plus the one just finished). */
function matchedIds(scenarios: Scenarios | null, likes: string[], extra?: { id: string; ok: boolean }): string[] {
  const ok = (id: string) => {
    if (extra && id === extra.id) return extra.ok;
    const st = scenarios?.find.pairs.find((p) => (p.a === ME && p.b === id) || (p.b === ME && p.a === id))?.status;
    return st === "strong" || st === "conditional";
  };
  return likes.filter(ok);
}

export default function Discover() {
  const [params] = useSearchParams();
  const target = findListing(params.get("listing") ?? undefined);
  const navigate = useNavigate();
  const { profiles, offline, loading, error, retry } = useProfiles();
  const sc = useScenarios();
  const { swipes } = useDemo();
  const me = profiles.find((p) => p.id === ME);
  const { deck, hidden } = useMemo(() => (me ? discoverDeck(me, profiles, swipes) : { deck: [], hidden: [] }), [me, profiles, swipes]);
  const card = useRef<CardHandle>(null);
  const [after, setAfter] = useState<{ other: Profile; negId: string | null; failed: boolean } | null>(null);
  const [replay, setReplay] = useState<{ id: string; other: Profile } | null>(null);

  const onSwiped = async (p: Profile, dir: SwipeDir) => {
    const bundled = pairId(sc.data, ME, p.id);
    demo.swipe(p.id, dir);
    if (dir === "pass") return;
    if (bundled) return setAfter({ other: p, negId: bundled, failed: false });
    setAfter({ other: p, negId: null, failed: false });
    try {
      if (offline) throw new Error("offline");
      const rec = await startNegotiation(ME, p.id);
      demo.setSwipeNegotiation(p.id, rec.id);
      setAfter({ other: p, negId: rec.id, failed: false });
    } catch {
      setAfter({ other: p, negId: null, failed: true });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (after || replay || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.key === "ArrowRight") card.current?.swipe("like");
      else if (e.key === "ArrowLeft") card.current?.swipe("pass");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [after, replay]);

  if (loading || sc.loading) return <PageLoading label="Loading students…" />;
  if (error || sc.error || !me) return <ErrorState title="Couldn't load Discover" onRetry={retry}>{error ?? sc.error ?? "Demo profile missing"}</ErrorState>;

  const top = deck[0];
  const last = swipes[swipes.length - 1];
  const likes = swipes.filter((s) => s.dir === "like").map((s) => s.id);
  const keep = target ? `&listing=${target.id}` : "";
  const goGroup = (extra?: { id: string; ok: boolean }) => navigate(`/roombae/roommates?with=${matchedIds(sc.data, likes, extra).join(",")}${keep}`);
  const filtered = hidden.filter((h): h is { p: Profile; reason: Exclude<HiddenReason, "seen"> } => h.reason !== "seen");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Discover</h1>
          <p className="hidden max-w-2xl text-sm text-slate-500 sm:block">
            Swipe right on anyone you'd live with. Your AI clone then talks to theirs about budget, sleep, guests and dealbreakers, so you only meet the ones who click.
            {target && <> Looking for roommates for <span className="font-medium text-slate-700">{target.title}</span>.</>}
          </p>
          <p className="text-sm text-slate-500 sm:hidden">Swipe right and your clones talk first.</p>
        </div>
        <FindTabs />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="flex flex-col items-center" aria-label="Students near you">
          <div className="relative h-[min(30rem,56svh)] w-full max-w-[22rem] sm:h-[min(32rem,70vh)]" data-deck={deck.map((p) => p.id).join(",")}>
            {deck.slice(1, 3).reverse().map((p) => {
              const depth = deck.indexOf(p);
              return (
                <motion.div key={p.id} className="absolute inset-0" style={{ zIndex: 10 - depth }} initial={false} animate={{ scale: 1 - depth * 0.05, y: depth * 14 }} transition={{ type: "spring", stiffness: 380, damping: 30 }} aria-hidden>
                  <CardFace p={p} />
                </motion.div>
              );
            })}
            {top ? (
              <SwipeCard key={top.id} ref={card} p={top} onSwiped={(dir) => onSwiped(top, dir)} />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-[1.75rem] border-2 border-dashed border-slate-300 bg-white/70 p-6 text-center" data-deck-empty>
                <div className="text-3xl" aria-hidden>✨</div>
                <h2 className="mt-2 text-lg font-semibold text-slate-900">You've seen everyone nearby</h2>
                <p className="mt-1 text-sm text-slate-500">Your clone's verdicts are in My matches.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Link to={`/roombae/matches${target ? `?listing=${target.id}` : ""}`} className={`rounded-full px-4 py-2 text-sm font-semibold ${R.primary}`}>See my matches</Link>
                  <button type="button" onClick={() => demo.clearSwipes()} className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">Start over</button>
                </div>
              </div>
            )}
          </div>
          <div className="mt-4 flex items-center gap-6 sm:mt-5">
            <button type="button" onClick={() => card.current?.swipe("pass")} disabled={!top} aria-label="Pass"
              className="grid h-16 w-16 place-items-center rounded-full bg-white text-3xl text-rose-500 shadow-lg ring-1 ring-slate-200 transition hover:scale-105 hover:bg-rose-50 disabled:opacity-40">✕</button>
            <button type="button" onClick={() => card.current?.swipe("like")} disabled={!top} aria-label="Like"
              className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-[#ff7a59] to-[#e8553e] text-3xl text-white shadow-lg shadow-orange-500/30 transition hover:scale-105 disabled:opacity-40">♥</button>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Drag the card, or press <kbd className="rounded bg-slate-100 px-1">←</kbd> pass · <kbd className="rounded bg-slate-100 px-1">→</kbd> like
            {last && <> · <button type="button" onClick={() => demo.unswipe(last.id)} className="font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">Undo {firstName(profiles.find((p) => p.id === last.id) ?? { name: "last" })}</button></>}
          </p>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-3">
              <Avatar id={me.id} name={me.name} color={me.color} size={12} />
              <div>
                <div className="font-semibold text-slate-900">{me.name} <span className="text-xs font-normal text-slate-400">(you)</span></div>
                <div className="text-xs text-slate-500">{me.program}, {me.school}</div>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-600">Your clone negotiates with what you told it:</p>
            <div className="mt-1.5"><ProfileFacts p={me} /></div>
          </div>
          <div className="rounded-2xl bg-white p-4 text-xs text-slate-600 shadow-sm ring-1 ring-slate-200" data-deck-filters>
            <div className="text-sm font-semibold text-slate-800">{deck.length} {deck.length === 1 ? "student" : "students"} left to see</div>
            <p className="mt-1">Same city first, then the same metro area; "same gender only" checked both ways; anyone you've swiped is hidden.</p>
            {filtered.length > 0 && (
              <ul className="mt-2 space-y-1">
                {filtered.map(({ p, reason }) => (
                  <li key={p.id} className="flex items-center gap-2 text-slate-500">
                    <Avatar id={p.id} name={p.name} color={p.color} size={5} />
                    <span><span className="font-medium text-slate-700">{p.name}</span> hidden: {HIDDEN_LABEL[reason]}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-slate-400">Swipe deck and My matches are adapted from Tanvi's AI Roommate Finder (Setup Match / My Matches).</p>
          </div>
        </aside>
      </div>

      {after && (
        <AfterLike me={me} other={after.other} negId={after.negId} failed={after.failed}
          onReplay={(id) => setReplay({ id, other: after.other })}
          onGroup={(done) => { const id = after.other.id; setAfter(null); goGroup({ id, ok: done.result.status !== "incompatible" }); }}
          onClose={() => setAfter(null)} />
      )}
      {replay && <ReplayDialog id={replay.id} a={me} b={replay.other} onClose={() => setReplay(null)} />}
    </div>
  );
}
