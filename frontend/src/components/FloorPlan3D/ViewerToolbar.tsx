import type { RoomType } from "../../types";
import type { PlanModel } from "./geometry";
import type { Angle } from "./PlanScene";
import { FLOOR_LABEL, FLOOR_SWATCH, type FloorKind, type RoomStyle } from "./livedIn";
import { ROOM_COLORS, ROOM_LABELS, SLAB } from "./theme";

const pill = "pointer-events-auto rounded-full bg-white/90 shadow-sm ring-1 ring-slate-200 backdrop-blur";

const PRESETS: { id: "top" | Angle; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "corner", label: "Corner" },
  { id: "front", label: "Front" },
  { id: "side", label: "Side" },
];

function RotateIcon({ flip }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className={`h-4 w-4 ${flip ? "-scale-x-100" : ""}`} fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M4.5 9.5a5.5 5.5 0 1 1 1.6 3.9" strokeLinecap="round" />
      <path d="M4 5.5v4h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Snaps the camera back to the viewer's default fit (its starting view, angle and zoom). */
export function ResetViewButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label="Reset view" title="Reset view: back to the default fit"
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 sm:text-sm ${className}`}>
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 8V3h5M17 12v5h-5M3.5 3.5 8 8M16.5 16.5 12 12" />
      </svg>
      <span className="sm:hidden">Reset</span>
      <span className="hidden sm:inline">Reset view</span>
    </button>
  );
}

export function ViewerToolbar({ preset, onPreset, onRotate, onResetView, show2D, onShow2D, canShow2D, wallHeight, onWallHeight, editable, editing, onEditing, onReset, itemCount,
  livedIn, onLivedIn, furnished, onFurnished }: {
  preset: "top" | Angle;
  onPreset: (p: "top" | Angle) => void;
  onRotate: (deg: number) => void;
  onResetView: () => void;
  show2D: boolean;
  onShow2D: (v: boolean) => void;
  canShow2D: boolean;
  wallHeight: number;
  onWallHeight: (v: number) => void;
  editable: boolean;
  editing: boolean;
  onEditing: (v: boolean) => void;
  onReset: () => void;
  itemCount: number;
  livedIn: boolean;
  onLivedIn: (v: boolean) => void;
  furnished: boolean;
  onFurnished: (v: boolean) => void;
}) {
  const toggle = (on: boolean) => `rounded-full px-2.5 py-1 text-xs font-medium transition-colors sm:px-3 sm:text-sm ${on ? "bg-teal-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`;
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-30 flex flex-wrap items-center gap-1.5 sm:inset-x-3 sm:top-3 sm:gap-2">
      <div className={`${pill} inline-flex items-center p-0.5 sm:p-1`} role="group" aria-label="Camera">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPreset(p.id)}
            aria-pressed={preset === p.id}
            aria-label={`${p.label} view`}
            title={`${p.label} view`}
            className={`rounded-full px-2 py-1 text-xs font-medium transition-colors sm:px-3 sm:text-sm ${
              preset === p.id ? "bg-teal-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="mx-0.5 h-4 w-px bg-slate-200" aria-hidden />
        <button type="button" onClick={() => onRotate(45)} aria-label="Rotate view 45° left" title="Rotate 45° left"
          className="rounded-full p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
          <RotateIcon />
        </button>
        <button type="button" onClick={() => onRotate(-45)} aria-label="Rotate view 45° right" title="Rotate 45° right"
          className="rounded-full p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
          <RotateIcon flip />
        </button>
        <span className="mx-0.5 h-4 w-px bg-slate-200" aria-hidden />
        <ResetViewButton onClick={onResetView} />
      </div>
      <button
        type="button"
        disabled={!canShow2D}
        onClick={() => onShow2D(!show2D)}
        aria-pressed={show2D}
        title={canShow2D ? "Overlay the original floor plan image" : "No image available"}
        className={`${pill} px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 sm:px-3 sm:text-sm ${
          show2D ? "bg-teal-600! text-white ring-teal-600" : "text-slate-600 hover:text-slate-900"
        }`}
      >
        <span className="sm:hidden">2D plan</span>
        <span className="hidden sm:inline">Show 2D plan</span>
      </button>
      <label className={`${pill} inline-flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-600 sm:px-3 sm:text-sm`}>
        <span className="hidden font-medium sm:inline">Walls</span>
        <input
          type="range"
          min={3}
          max={12}
          step={0.5}
          value={wallHeight}
          onChange={(e) => onWallHeight(Number(e.target.value))}
          className="teal-range w-14 sm:w-28"
          aria-label="Wall height in feet"
        />
        <span className="w-8 tabular-nums text-slate-800 sm:w-9">{wallHeight} ft</span>
      </label>
      {editable && (
        <button
          type="button"
          onClick={() => onEditing(!editing)}
          aria-pressed={editing}
          className={`${pill} px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm ${
            editing ? "bg-teal-600! text-white ring-teal-600" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {editing ? "Done editing" : "Edit layout"}
        </button>
      )}
      {editable && editing && itemCount > 0 && (
        <button type="button" onClick={onReset} className={`${pill} px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-red-700 sm:px-3 sm:text-sm`}>
          Reset layout
        </button>
      )}
      {/* last, so the camera / edit controls keep their places (the room panel covers the right side) */}
      <div className={`${pill} inline-flex items-center p-0.5 sm:p-1`} role="group" aria-label="Look">
        <button type="button" onClick={() => onLivedIn(!livedIn)} aria-pressed={livedIn} title="Painted walls and real floors (from the listing's photos when it has them)" className={toggle(livedIn)} data-toggle="lived-in">
          Lived-in
        </button>
        <button type="button" onClick={() => onFurnished(!furnished)} aria-pressed={furnished} disabled={editing} title="Furniture placed in every room with the fit check" className={`${toggle(furnished)} disabled:opacity-40`} data-toggle="furnished">
          Furnished
        </button>
      </div>
    </div>
  );
}

export function Legend({ model, editing = false, styles = null }: { model: PlanModel; editing?: boolean; styles?: Map<string, Required<RoomStyle>> | null }) {
  const types = Array.from(new Set(model.rooms.map((r) => r.room.type))) as RoomType[];
  const floors = styles ? (Array.from(new Set([...styles.values()].map((s) => s.floor))) as FloorKind[]) : [];
  const fromPhotos = styles ? [...styles.values()].some((s) => s.source === "photos") : false;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20 hidden flex-wrap gap-x-3 gap-y-1 rounded-xl bg-white/80 px-3 py-2 text-[11px] text-slate-600 ring-1 ring-slate-200 backdrop-blur sm:flex sm:max-w-[60%]">
      {styles && floors.map((f) => (
        <span key={f} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm ring-1 ring-black/10" style={{ background: FLOOR_SWATCH[f] }} />
          {FLOOR_LABEL[f]}
        </span>
      ))}
      {styles && <span className="text-slate-500">{fromPhotos ? "Walls and floors from the photos" : "Walls: soft palette"}</span>}
      {!styles && types.map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm ring-1 ring-black/10" style={{ background: ROOM_COLORS[t] }} />
          {ROOM_LABELS[t]}
        </span>
      ))}
      {model.footprint.length > 0 && (
        <span className="inline-flex items-center gap-1.5" title="Floor no room covers: halls, landings">
          <span className="h-2.5 w-2.5 rounded-sm ring-1 ring-black/10" style={{ background: SLAB }} />
          Hallway
        </span>
      )}
      {editing && (
        <>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-green-500" />Fits</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" />Doesn't fit</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-amber-500 bg-amber-200/70" />
            Keep clear (doorway)
          </span>
        </>
      )}
      <span className="text-slate-400">
        {editing ? "Click a room, add furniture, drag it on the floor" : "Drag to orbit · scroll to zoom · click a room"}
      </span>
    </div>
  );
}
