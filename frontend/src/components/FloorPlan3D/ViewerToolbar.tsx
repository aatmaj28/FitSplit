import type { RoomType } from "../../types";
import type { PlanModel } from "./geometry";
import type { ViewMode } from "./PlanScene";
import { ROOM_COLORS, ROOM_LABELS } from "./theme";

const pill = "pointer-events-auto rounded-full bg-white/90 shadow-sm ring-1 ring-slate-200 backdrop-blur";

export function ViewerToolbar({ view, onView, show2D, onShow2D, canShow2D, wallHeight, onWallHeight, editable, editing, onEditing, onReset, itemCount }: {
  view: ViewMode;
  onView: (v: ViewMode) => void;
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
}) {
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-30 flex flex-wrap items-center gap-2 sm:inset-x-3 sm:top-3">
      <div className={`${pill} inline-flex p-1`} role="group" aria-label="Camera">
        {(["3d", "top"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onView(v)}
            aria-pressed={view === v}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors sm:px-3 sm:text-sm ${
              view === v ? "bg-teal-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {v === "3d" ? "3D view" : "Top view"}
          </button>
        ))}
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
    </div>
  );
}

export function Legend({ model, editing = false }: { model: PlanModel; editing?: boolean }) {
  const types = Array.from(new Set(model.rooms.map((r) => r.room.type))) as RoomType[];
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20 hidden flex-wrap gap-x-3 gap-y-1 rounded-xl bg-white/80 px-3 py-2 text-[11px] text-slate-600 ring-1 ring-slate-200 backdrop-blur sm:flex sm:max-w-[60%]">
      {types.map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm ring-1 ring-black/10" style={{ background: ROOM_COLORS[t] }} />
          {ROOM_LABELS[t]}
        </span>
      ))}
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
