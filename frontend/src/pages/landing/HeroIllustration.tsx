import { motion, useReducedMotion } from "framer-motion";
import { useLayoutEffect, useRef, useState } from "react";
import { CAST, Face, tint } from "./cast";
import { IconCheck, IconCube, IconPlan, IconRefresh, IconSparkle } from "./icons";

/*
 * Hero illustration: a 2D floor plan draws itself, tilts into an isometric 3D apartment (walls rise as
 * stacked layers in a CSS 3D context), three roommate cards swipe in and the rent splits three ways.
 * Plays once (Replay restarts it); with reduced motion it renders the final frame.
 */

// stage (design size, scaled to the available width)
const SW = 480;
const SH = 440;
// floor plan (px at scale 1)
const PW = 300;
const PH = 240;
// final camera
const TILT = 52;
const TURN = -38;
const S3 = 0.9;
const CX = 186;
const CY = 200;
// 2D start: the plan sits centered on the stage
const X2D = SW / 2 - CX;
const S2 = 0.98;
const WALL_LAYERS = 10;
const WALL_STEP = 2.2;
const FURN_Z = [2, 4, 6];
const SLAB_Z = [-1.5, -3, -4.5, -6];

const EASE: [number, number, number, number] = [0.65, 0, 0.35, 1];
const OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
const T = { lift: 0.85, liftDur: 0.8, tint: 1.15, furn: 1.3, cards: 1.25, split: 1.5, chip: 1.8 };

const SHARES = [1360, 1352, 1488]; // the JVUE 3 bed fair split: Priya, Ananya, Meera = $4,200
const PEOPLE = CAST.map((p, i) => ({ ...p, note: i === 0 ? "You" : "Clones agree", share: SHARES[i] }));
const RENT = PEOPLE.reduce((a, p) => a + p.share, 0);

function lerpColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round((((pa >> s) & 255) * (1 - t)) + (((pb >> s) & 255) * t));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/** Where plan point (x, y) at height z lands on the stage once the model has lifted. */
function iso(x: number, y: number, z = 0) {
  const a = (TURN * Math.PI) / 180;
  const t = (TILT * Math.PI) / 180;
  const dx = x - PW / 2;
  const dy = y - PH / 2;
  const rx = dx * Math.cos(a) - dy * Math.sin(a);
  const ry = dx * Math.sin(a) + dy * Math.cos(a);
  return { x: CX + S3 * rx, y: CY + S3 * (ry * Math.cos(t) - z * Math.sin(t)) };
}

const OUTER = "M48 230H290V10H10V230H20";
const WALLS = [
  "M110 10V110", "M170 10V110", "M10 110H72", "M100 110H110", "M110 80H124", "M150 80H170",
  "M170 110H184", "M212 110H290", "M200 140H212", "M238 140H290", "M200 140V230",
  "M250 140V178", "M250 178H260", "M282 178H290",
];
const DOORS = [
  { leaf: "M20 230V202", arc: "M48 230A28 28 0 0 0 20 202" },
  { leaf: "M100 110V82", arc: "M72 110A28 28 0 0 1 100 82" },
  { leaf: "M150 80V54", arc: "M124 80A26 26 0 0 1 150 54" },
  { leaf: "M184 110V82", arc: "M212 110A28 28 0 0 0 184 82" },
  { leaf: "M212 140V166", arc: "M238 140A26 26 0 0 1 212 166" },
  { leaf: "M282 178V156", arc: "M260 178A22 22 0 0 1 282 156" },
];
const LABELS = [
  { x: 60, y: 56, name: "BEDROOM 1", dims: "11′ × 12′" },
  { x: 230, y: 56, name: "BEDROOM 2", dims: "13′ × 11′" },
  { x: 226, y: 203, name: "BEDROOM 3", dims: "10′ × 10′" },
  { x: 140, y: 34, name: "BATH", dims: "" },
  { x: 104, y: 160, name: "LIVING", dims: "18′ × 13′" },
];
const BEDS = [
  { x: 16, y: 16, w: 44, h: 56, color: PEOPLE[0].color },
  { x: 239, y: 16, w: 45, h: 56, color: PEOPLE[1].color },
  { x: 206, y: 176, w: 40, h: 48, color: PEOPLE[2].color },
];
const PIECES = [
  { x: 80, y: 16, w: 26, h: 12, r: 1.5 }, // desk, bedroom 1
  { x: 176, y: 16, w: 28, h: 12, r: 1.5 }, // desk, bedroom 2
  { x: 14, y: 116, w: 16, h: 78, r: 1 }, // kitchen counter
  { x: 46, y: 134, w: 34, h: 14, r: 2 }, // island
  { x: 50, y: 172, w: 34, h: 24, r: 3 }, // dining table
  { x: 112, y: 206, w: 62, h: 18, r: 4 }, // sofa
  { x: 128, y: 182, w: 30, h: 13, r: 3 }, // coffee table
  { x: 114, y: 14, w: 52, h: 20, r: 6 }, // tub
  { x: 254, y: 143, w: 32, h: 11, r: 2 }, // shower
];

const layer = "absolute inset-0";
const svgProps = { width: PW, height: PH, viewBox: `0 0 ${PW} ${PH}`, overflow: "visible" as const };

function Furniture({ top }: { top: boolean }) {
  const fill = top ? "#ffffff" : "#d9e1ea";
  const stroke = top ? "#cbd5e1" : "none";
  return (
    <svg {...svgProps}>
      {PIECES.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r} fill={fill} stroke={stroke} strokeWidth={0.8} />
      ))}
      {BEDS.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={3} fill={fill} stroke={stroke} strokeWidth={0.8} />
          {top && (
            <>
              <rect x={b.x + 3} y={b.y + 3} width={b.w / 2 - 4.5} height={9} rx={2.5} fill="#fff" stroke="#cbd5e1" strokeWidth={0.7} />
              <rect x={b.x + b.w / 2 + 1.5} y={b.y + 3} width={b.w / 2 - 4.5} height={9} rx={2.5} fill="#fff" stroke="#cbd5e1" strokeWidth={0.7} />
              <rect x={b.x + 1.5} y={b.y + 16} width={b.w - 3} height={b.h - 17.5} rx={2.5} fill={tint(b.color, 0.45)} />
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

function Stage({ reduce }: { reduce: boolean }) {
  const init = <V,>(v: V) => (reduce ? false : v);
  const chip = iso(38, 44, 9);
  return (
    <div className="absolute inset-0" aria-hidden>
      {/* soft shadow under the lifted model */}
      <motion.div
        className="absolute rounded-full"
        style={{ left: CX - 190, top: CY - 62, width: 380, height: 170, background: "radial-gradient(closest-side, rgba(15,23,42,0.16), rgba(15,23,42,0))" }}
        initial={init({ opacity: 0, scale: 0.7 })}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: T.lift + 0.25, duration: 0.7, ease: OUT }}
      />

      {/* the model: a flat plan that tilts into 3D */}
      <motion.div
        className="absolute"
        style={{ left: CX - PW / 2, top: CY - PH / 2, width: PW, height: PH, transformStyle: "preserve-3d" }}
        initial={init({ x: X2D, rotateX: 0, rotateZ: 0, scale: S2 })}
        animate={{ x: 0, rotateX: TILT, rotateZ: TURN, scale: S3 }}
        transition={{ delay: T.lift, duration: T.liftDur, ease: EASE }}
      >
        {/* slab edge */}
        {SLAB_Z.map((z, i) => (
          <motion.div key={`s${i}`} className={layer} initial={init({ z: 0, opacity: 0 })} animate={{ z, opacity: 1 }}
            transition={{ delay: T.lift, duration: T.liftDur, ease: EASE }}>
            <svg {...svgProps}><rect x={4} y={4} width={292} height={232} rx={3} fill={lerpColor("#e2e8f0", "#b6c2d1", i / (SLAB_Z.length - 1))} /></svg>
          </motion.div>
        ))}

        {/* floor: paper, room colors, door swings, labels */}
        <div className={layer}>
          <svg {...svgProps}>
            <rect x={4} y={4} width={292} height={232} rx={3} fill="#fff" stroke="#e2e8f0" strokeWidth={1} />
            <motion.g initial={init({ opacity: 0 })} animate={{ opacity: 1 }} transition={{ delay: T.tint, duration: 0.6 }}>
              <rect x={10} y={110} width={190} height={120} fill="#faf7f2" />
              <rect x={200} y={110} width={90} height={30} fill="#faf7f2" />
              <rect x={110} y={80} width={60} height={30} fill="#faf7f2" />
              <rect x={10} y={10} width={100} height={100} fill={tint(PEOPLE[0].color, 0.84)} />
              <rect x={170} y={10} width={120} height={100} fill={tint(PEOPLE[1].color, 0.86)} />
              <rect x={200} y={140} width={90} height={90} fill={tint(PEOPLE[2].color, 0.86)} />
              <rect x={110} y={10} width={60} height={70} fill="#e0f2fe" />
              <rect x={250} y={140} width={40} height={38} fill="#e0f2fe" />
              <rect x={108} y={168} width={70} height={50} rx={4} fill="#efe9df" />
            </motion.g>
            <g fill="none" strokeLinecap="round">
              {DOORS.map((d, i) => (
                <g key={i}>
                  <motion.path d={d.arc} stroke="#cbd5e1" strokeWidth={1} initial={init({ pathLength: 0, opacity: 0 })} animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ delay: 0.5 + i * 0.04, duration: 0.35, ease: "easeOut" }} />
                  <motion.path d={d.leaf} stroke="#94a3b8" strokeWidth={1.6} initial={init({ opacity: 0 })} animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 + i * 0.04, duration: 0.2 }} />
                </g>
              ))}
            </g>
            <motion.g initial={init({ opacity: 0 })} animate={reduce ? { opacity: 0 } : { opacity: [0, 1, 1, 0] }}
              transition={{ duration: T.lift + 0.3, times: [0, 0.45, 0.75, 1], ease: "linear" }}
              fontFamily="ui-sans-serif, system-ui, sans-serif" textAnchor="middle">
              {LABELS.map((l) => (
                <g key={l.name}>
                  <text x={l.x} y={l.y} fontSize={7.5} fontWeight={700} letterSpacing="0.06em" fill="#64748b">{l.name}</text>
                  {l.dims && <text x={l.x} y={l.y + 10} fontSize={7} fill="#94a3b8">{l.dims}</text>}
                </g>
              ))}
              <g stroke="#94a3b8" strokeWidth={0.8}>
                <path d="M10 -8H290M10 -11V-5M290 -11V-5" />
                <path d="M-8 10V230M-11 10H-5M-11 230H-5" />
              </g>
              <text x={150} y={-11} fontSize={7} fill="#64748b">36′ 0″</text>
              <text x={-12} y={122} fontSize={7} fill="#64748b" transform="rotate(-90 -12 122)">29′ 6″</text>
            </motion.g>
          </svg>
        </div>

        {/* furniture drops in after the lift */}
        {FURN_Z.map((z, i) => (
          <motion.div key={`f${i}`} className={layer} initial={init({ z: z + 34, opacity: 0 })} animate={{ z, opacity: 1 }}
            transition={{ delay: T.furn + i * 0.02, duration: 0.45, ease: OUT }}>
            <Furniture top={i === FURN_Z.length - 1} />
          </motion.div>
        ))}

        {/* walls: one layer draws itself, the rest stack up beneath it to extrude the walls */}
        {Array.from({ length: WALL_LAYERS }, (_, i) => {
          const top = i === WALL_LAYERS - 1;
          const stroke = top ? "#1e293b" : lerpColor("#aab6c6", "#e6ebf1", i / (WALL_LAYERS - 2));
          return (
            <motion.div key={`w${i}`} className={layer} initial={init({ z: 0, opacity: top ? 1 : 0 })} animate={{ z: (i + 1) * WALL_STEP, opacity: 1 }}
              transition={{ z: { delay: T.lift + 0.08, duration: T.liftDur, ease: EASE }, opacity: { delay: T.lift, duration: 0.05 } }}>
              <svg {...svgProps}>
                <g fill="none" stroke={stroke} strokeWidth={5} strokeLinecap="square" strokeLinejoin="miter">
                  {[OUTER, ...WALLS].map((d, j) =>
                    top ? (
                      <motion.path key={j} d={d} initial={init({ pathLength: 0, opacity: 0 })} animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ pathLength: { delay: j === 0 ? 0 : 0.18 + j * 0.03, duration: j === 0 ? 0.6 : 0.32, ease: "easeInOut" }, opacity: { delay: j === 0 ? 0 : 0.18 + j * 0.03, duration: 0.01 } }} />
                    ) : (
                      <path key={j} d={d} />
                    ),
                  )}
                </g>
              </svg>
            </motion.div>
          );
        })}
      </motion.div>

      {/* what you're looking at */}
      <div className="absolute left-4 top-4 h-7 text-[11px] font-semibold text-slate-600">
        <motion.span className="absolute left-0 top-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/95 px-2.5 py-1 ring-1 ring-slate-200"
          initial={init({ opacity: 1 })} animate={{ opacity: 0 }} transition={{ delay: T.lift, duration: 0.25 }}>
          <IconPlan className="h-3.5 w-3.5 text-slate-500" /> Floor plan
        </motion.span>
        <motion.span className="absolute left-0 top-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/95 px-2.5 py-1 ring-1 ring-teal-200"
          initial={init({ opacity: 0, y: 4 })} animate={{ opacity: 1, y: 0 }} transition={{ delay: T.lift + 0.2, duration: 0.35 }}>
          <IconCube className="h-3.5 w-3.5 text-teal-600" /> 3D view · real room sizes
        </motion.span>
      </div>

      {/* furniture check */}
      <motion.div className="absolute" style={{ left: chip.x, top: chip.y }}
        initial={init({ opacity: 0, scale: 0.6 })} animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: T.chip, type: "spring", stiffness: 380, damping: 22 }}>
        <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500 ring-4 ring-emerald-500/25" />
        <span className="absolute bottom-3 left-0 -translate-x-1/4 whitespace-nowrap rounded-full bg-emerald-600 py-1 pl-1.5 pr-2.5 text-[11px] font-semibold text-white shadow-lg shadow-emerald-900/20">
          <span className="inline-flex items-center gap-1"><IconCheck className="h-3.5 w-3.5" /> Queen bed fits</span>
        </span>
      </motion.div>

      {/* roommates swipe in */}
      {PEOPLE.map((p, i) => (
        <motion.div key={p.id} className="absolute right-4 flex min-w-[148px] items-center gap-2 whitespace-nowrap rounded-2xl bg-white/95 p-1.5 pr-3.5 shadow-lg shadow-slate-900/[0.07] ring-1 ring-slate-200/80"
          style={{ top: 16 + i * 50 }}
          initial={init({ opacity: 0, x: 90, rotate: 12 })}
          animate={{ opacity: 1, x: 0, rotate: [-1.5, 1.2, -0.6][i] }}
          transition={{ default: { delay: T.cards + i * 0.13, type: "spring", stiffness: 240, damping: 21 }, opacity: { delay: T.cards + i * 0.13, duration: 0.2 } }}>
          <Face id={p.id} color={p.color} className="h-8 w-8" />
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold leading-tight text-slate-800">{p.name}</span>
            {p.note === "You" ? (
              <span className="mt-0.5 inline-block rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold leading-4 text-slate-500">You</span>
            ) : (
              <span className="mt-0.5 flex items-center gap-1 text-[11px] leading-tight text-emerald-700">
                <IconSparkle className="h-3 w-3" /> {p.note}
              </span>
            )}
          </span>
        </motion.div>
      ))}

      {/* the rent splits three ways */}
      <motion.div className="absolute inset-x-4 bottom-4 rounded-2xl bg-white/95 px-4 py-3 shadow-lg shadow-slate-900/[0.07] ring-1 ring-slate-200/80"
        initial={init({ opacity: 0, y: 18 })} animate={{ opacity: 1, y: 0 }} transition={{ delay: T.split - 0.15, duration: 0.4, ease: OUT }}>
        <div className="flex items-baseline justify-between text-[12px]">
          <span className="font-semibold text-slate-800">Fair rent split</span>
          <span className="tabular-nums text-slate-500">${RENT.toLocaleString("en-US")} / month</span>
        </div>
        <div className="mt-2 flex h-2.5 gap-[3px]">
          {PEOPLE.map((p, i) => (
            <div key={p.id} className="h-full overflow-hidden rounded-full bg-slate-100" style={{ flexGrow: p.share, flexBasis: 0 }}>
              <motion.div className="h-full w-full origin-left rounded-full" style={{ background: p.color }}
                initial={init({ scaleX: 0 })} animate={{ scaleX: 1 }} transition={{ delay: T.split + i * 0.15, duration: 0.3, ease: "easeOut" }} />
            </div>
          ))}
        </div>
        <div className="mt-2 flex text-[11px] text-slate-500">
          {PEOPLE.map((p, i) => (
            <motion.span key={p.id} className="flex items-center gap-1.5" style={{ flexGrow: p.share, flexBasis: 0 }}
              initial={init({ opacity: 0 })} animate={{ opacity: 1 }} transition={{ delay: T.split + i * 0.15 + 0.15, duration: 0.25 }}>
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name} <span className="font-semibold tabular-nums text-slate-800">${p.share.toLocaleString("en-US")}</span>
            </motion.span>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

/** Scales the fixed-size stage to the width it gets. */
function useFit(max = 1.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(SW);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w, s: Math.min(max, w / SW) };
}

export default function HeroIllustration() {
  const reduce = useReducedMotion() ?? false;
  const [run, setRun] = useState(0);
  const { ref, w, s } = useFit();
  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height: SH * s }}>
        <div
          className="absolute top-0 origin-top-left overflow-hidden rounded-[28px] bg-white shadow-[0_40px_80px_-40px_rgba(15,23,42,0.35)] ring-1 ring-slate-200/80"
          style={{ width: SW, height: SH, left: (w - SW * s) / 2, transform: `scale(${s})` }}
          role="img"
          aria-label="A floor plan draws itself and rises into a 3D apartment while three roommates match and the rent splits three ways."
        >
          <div aria-hidden className="absolute inset-0"
            style={{
              backgroundImage: "linear-gradient(to right, rgba(13,148,136,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(13,148,136,0.07) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
              maskImage: "radial-gradient(ellipse 75% 70% at 45% 45%, #000 30%, transparent 85%)",
              WebkitMaskImage: "radial-gradient(ellipse 75% 70% at 45% 45%, #000 30%, transparent 85%)",
            }} />
          <Stage key={run} reduce={reduce} />
        </div>
      </div>
      {!reduce && (
        <div className="mt-2 flex justify-end pr-1">
          <button type="button" onClick={() => setRun((r) => r + 1)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:text-slate-700">
            <IconRefresh className="h-3.5 w-3.5" /> Replay
          </button>
        </div>
      )}
    </div>
  );
}
