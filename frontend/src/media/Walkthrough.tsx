import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MediaJob } from "./api";
import { MediaImg } from "./PhotoViewer";

export interface WalkHotspot { to: string; name: string; frame: number; x: number | null; photo: number }
export interface WalkRoom {
  id: string; name: string; type: string; frames: number[]; photos: string[];
  pano: string | null; pano_size: [number, number] | null; pano_frames: number[]; hotspots: WalkHotspot[];
}
export interface Walk { rooms: WalkRoom[]; entrance: string | null; connections: { a: string; b: string; kind: string }[] }
/** Room rectangles for the minimap (feet), from the estimated layout when there is one, with the
 *  walkthrough rooms each one holds (an engine's rooms needn't match the walkthrough's one to one). */
export type MiniRect = { id: string; x: number; y: number; w: number; h: number; walkIds: string[] };

export function walkOf(job: MediaJob | null): Walk | null {
  const w = (job as (MediaJob & { walkthrough?: Walk | null }) | null)?.walkthrough;
  return w && w.rooms.length ? w : null;
}

function Arrow({ dir = "up" }: { dir?: "up" | "left" | "right" }) {
  const r = { up: 0, right: 90, left: -90 }[dir];
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" style={{ transform: `rotate(${r}deg)` }} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5m-6 6 6-6 6 6" />
    </svg>
  );
}

function Hotspot({ h, onGo, style }: { h: WalkHotspot; onGo: (id: string) => void; style?: React.CSSProperties }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onGo(h.to); }} onPointerDown={(e) => e.stopPropagation()} style={style} data-hotspot={h.to}
      className="group absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 focus:outline-none">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-white/90 text-slate-900 shadow-lg ring-4 ring-white/30 transition group-hover:scale-110 group-focus-visible:ring-sky-400">
        <Arrow />
      </span>
      <span className="whitespace-nowrap rounded-full bg-slate-900/80 px-2.5 py-0.5 text-xs font-semibold text-white">{h.name}</span>
    </button>
  );
}

/** A stitched room: drag (or ← →) to look along it; hotspots ride along with the image. */
function PanoView({ job, room, onGo, look, setLook }: { job: MediaJob; room: WalkRoom; onGo: (id: string) => void; look: number; setLook: (f: (x: number) => number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const [pw, ph] = room.pano_size ?? [1600, 600];
  const scale = Math.max(size.h / ph, size.w / pw);
  const W = pw * scale, H = ph * scale;
  const span = Math.max(0, W - size.w);
  const left = -span * look;
  const top = -(H - size.h) / 2;
  const drag = useRef<{ x: number; look: number } | null>(null);
  return (
    <div ref={box} className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing" data-pano={room.id}
      onPointerDown={(e) => { drag.current = { x: e.clientX, look }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { const d = drag.current; if (d && span > 0) setLook(() => Math.min(1, Math.max(0, d.look - (e.clientX - d.x) / span))); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <div className="absolute transition-transform duration-75" style={{ width: W, height: H, transform: `translate(${left}px, ${top}px)` }} data-pano-x={look.toFixed(2)}>
        <MediaImg jobId={job.id} file={room.pano!} offline={job.offline} alt={`${room.name} panorama`} className="pointer-events-none h-full w-full select-none" />
        {room.hotspots.filter((h) => h.x != null).map((h) => <Hotspot key={h.to} h={h} onGo={onGo} style={{ left: `${h.x! * 100}%`, top: "60%" }} />)}
      </div>
      {span > 0 && look > 0.01 && (
        <button type="button" aria-label="Look left" onPointerDown={(e) => e.stopPropagation()} onClick={() => setLook((x) => Math.max(0, x - 0.25))}
          className="absolute inset-y-0 left-0 flex w-12 items-center justify-start bg-gradient-to-r from-black/35 to-transparent pl-2 text-white/90 hover:from-black/50"><Arrow dir="left" /></button>
      )}
      {span > 0 && look < 0.99 && (
        <button type="button" aria-label="Look right" onPointerDown={(e) => e.stopPropagation()} onClick={() => setLook((x) => Math.min(1, x + 0.25))}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-end bg-gradient-to-l from-black/35 to-transparent pr-2 text-white/90 hover:from-black/50"><Arrow dir="right" /></button>
      )}
    </div>
  );
}

/** A room that didn't stitch: its photos, swipe or ← → between them. */
function PhotoSetView({ job, room, onGo, photo, setPhoto }: { job: MediaJob; room: WalkRoom; onGo: (id: string) => void; photo: number; setPhoto: (f: (i: number) => number) => void }) {
  const drag = useRef<number | null>(null);
  const n = room.photos.length;
  return (
    <div className="absolute inset-0 touch-pan-y" data-photoset={room.id}
      onPointerDown={(e) => { drag.current = e.clientX; }}
      onPointerUp={(e) => {
        const d = drag.current === null ? 0 : e.clientX - drag.current;
        drag.current = null;
        if (Math.abs(d) > 50) setPhoto((i) => (i + (d < 0 ? 1 : -1) + n) % n);
      }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div key={photo} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
          <MediaImg jobId={job.id} file={room.photos[photo]} offline={job.offline} alt={`${room.name}, photo ${photo + 1}`} className="pointer-events-none h-full w-full select-none object-cover" />
        </motion.div>
      </AnimatePresence>
      {room.hotspots.filter((h) => h.photo === photo).map((h, k, all) => (
        <Hotspot key={h.to} h={h} onGo={onGo} style={{ left: `${50 + (k - (all.length - 1) / 2) * Math.min(22, 80 / all.length)}%`, top: "58%" }} />
      ))}
      {n > 1 && (
        <>
          <button type="button" aria-label="Previous photo" onClick={() => setPhoto((i) => (i - 1 + n) % n)} className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60"><Arrow dir="left" /></button>
          <button type="button" aria-label="Next photo" onClick={() => setPhoto((i) => (i + 1) % n)} className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60"><Arrow dir="right" /></button>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1">{room.photos.map((_, i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === photo ? "bg-white" : "bg-white/40"}`} />)}</div>
        </>
      )}
    </div>
  );
}

/** Where you are: the estimated layout's rooms (when there is one), else the rooms in walk order. */
function Minimap({ walk, here, rects, onGo }: { walk: Walk; here: string; rects?: MiniRect[]; onGo: (id: string) => void }) {
  if (rects?.length) {
    const minX = Math.min(...rects.map((r) => r.x)), minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.w)), maxY = Math.max(...rects.map((r) => r.y + r.h));
    const cur = rects.find((r) => r.walkIds.includes(here));
    return (
      <svg viewBox={`${minX - 1} ${minY - 1} ${maxX - minX + 2} ${maxY - minY + 2}`} className="h-28 w-36 rounded-xl bg-slate-900/70 p-1.5 backdrop-blur sm:h-32 sm:w-44" data-minimap aria-label="Map of the rooms">
        {rects.map((r) => {
          const names = r.walkIds.map((id) => walk.rooms.find((x) => x.id === id)?.name).filter(Boolean).join(", ");
          const on = r.walkIds.includes(here);
          return (
            <g key={r.id} onClick={() => r.walkIds[0] && onGo(r.walkIds[0])} className={r.walkIds.length ? "cursor-pointer" : ""}>
              <title>{names}</title>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={0.4} fill={on ? "#38bdf8" : "#e2e8f0"} fillOpacity={on ? 0.9 : r.walkIds.length ? 0.25 : 0.12} stroke="#f8fafc" strokeWidth={0.25} />
            </g>
          );
        })}
        {cur && <circle cx={cur.x + cur.w / 2} cy={cur.y + cur.h / 2} r={Math.max(0.8, Math.min(cur.w, cur.h) * 0.12)} fill="#fff" stroke="#0284c7" strokeWidth={0.4}><animate attributeName="r" values="0.8;1.4;0.8" dur="1.6s" repeatCount="indefinite" /></circle>}
      </svg>
    );
  }
  return (
    <div className="flex max-w-[70vw] flex-wrap gap-1 rounded-xl bg-slate-900/70 p-1.5 backdrop-blur" data-minimap>
      {walk.rooms.map((r) => (
        <button key={r.id} type="button" onClick={() => onGo(r.id)} aria-current={r.id === here ? "location" : undefined}
          className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${r.id === here ? "bg-sky-400 text-slate-900" : "text-slate-200 hover:bg-white/10"}`}>
          {r.id === here ? "● " : ""}{r.name}
        </button>
      ))}
    </div>
  );
}

/**
 * Walk the listing room by room: stitched rooms are a panorama to drag along, others a photo set.
 * Arrow hotspots lead to connected rooms (fade between them). Keys: ← → look / next photo,
 * ↑ go through the door in view, ↓ back to the previous room.
 */
export function Walkthrough({ job, walk, rects, className = "" }: { job: MediaJob; walk: Walk; rects?: MiniRect[]; className?: string }) {
  const start = walk.entrance && walk.rooms.some((r) => r.id === walk.entrance) ? walk.entrance : walk.rooms[0].id;
  const [here, setHere] = useState(start);
  const [trail, setTrail] = useState<string[]>([]);
  const [look, setLook] = useState(0.5);
  const [photo, setPhoto] = useState(0);
  const room = walk.rooms.find((r) => r.id === here) ?? walk.rooms[0];
  const index = walk.rooms.indexOf(room);
  const go = useCallback((id: string, back = false) => {
    if (id === here) return;
    setTrail((t) => (back ? t.slice(0, -1) : [...t, here]));
    setHere(id);
    setLook(0.5);
    setPhoto(0);
  }, [here]);
  const wrap = useRef<HTMLDivElement>(null);
  // the door "in view": the hotspot closest to the middle of the panorama view, or on this photo
  const ahead = useMemo(() => {
    if (room.pano) return [...room.hotspots].filter((h) => h.x != null).sort((a, b) => Math.abs(a.x! - look) - Math.abs(b.x! - look))[0] ?? room.hotspots[0];
    return room.hotspots.find((h) => h.photo === photo) ?? room.hotspots[0];
  }, [room, look, photo]);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const d = e.key === "ArrowLeft" ? -1 : 1;
        if (room.pano) setLook((x) => Math.min(1, Math.max(0, x + d * 0.12)));
        else setPhoto((i) => (i + d + room.photos.length) % room.photos.length);
      } else if (e.key === "ArrowUp" && ahead) go(ahead.to);
      else if (e.key === "ArrowDown" && trail.length) go(trail[trail.length - 1], true);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [room, ahead, trail, go]);
  const offPano = room.pano ? room.hotspots.filter((h) => h.x == null) : [];
  return (
    <div ref={wrap} tabIndex={0} className={`relative h-full min-h-[320px] select-none overflow-hidden rounded-2xl bg-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${className}`}
      aria-label={`Walkthrough: ${room.name}. Drag or use the arrow keys to look around; up arrow goes through the door in view.`} data-walkthrough data-room={room.id}>
      <AnimatePresence initial={false}>
        <motion.div key={room.id} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }}>
          {room.pano ? <PanoView job={job} room={room} onGo={go} look={look} setLook={setLook} /> : <PhotoSetView job={job} room={room} onGo={go} photo={photo} setPhoto={setPhoto} />}
        </motion.div>
      </AnimatePresence>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/55 to-transparent p-3">
        <div className="pointer-events-auto">
          <div className="text-lg font-semibold text-white drop-shadow" data-room-label>{room.name}</div>
          <div className="text-xs text-slate-200">Room {index + 1} of {walk.rooms.length}{room.pano ? " · drag to look around" : ` · photo ${photo + 1} of ${room.photos.length}`}</div>
        </div>
        {trail.length > 0 && (
          <button type="button" onClick={() => go(trail[trail.length - 1], true)} className="pointer-events-auto rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-white hover:bg-black/65">
            ← Back to {walk.rooms.find((r) => r.id === trail[trail.length - 1])?.name}
          </button>
        )}
      </div>
      {(offPano.length > 0 || (!room.pano && room.hotspots.some((h) => h.photo !== photo))) && (
        <div className="absolute bottom-3 right-3 flex flex-col items-end gap-1.5">
          {(room.pano ? offPano : room.hotspots.filter((h) => h.photo !== photo)).map((h) => (
            <button key={h.to} type="button" onClick={() => go(h.to)} data-hotspot={h.to} className="flex items-center gap-1 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-900 shadow hover:bg-white">
              {h.name} <Arrow dir="right" />
            </button>
          ))}
        </div>
      )}
      <div className="absolute bottom-3 left-3"><Minimap walk={walk} here={room.id} rects={rects} onGo={(id) => go(id)} /></div>
    </div>
  );
}
