import type { RefObject } from "react";
import type { PlanModel } from "./geometry";
import { formatRoomArea } from "./theme";

/**
 * One DOM layer for all room labels (crisp text, readable from any angle, works offline).
 * Positions are written every frame by <LabelProjector> inside the canvas.
 */
export function LabelLayer({ model, selectedId, onSelect, els, passThrough = false }: {
  model: PlanModel;
  selectedId: string | null;
  onSelect: (id: string) => void;
  els: RefObject<(HTMLElement | null)[]>;
  /** editing furniture: labels fade and let pointer events through to the pieces under them */
  passThrough?: boolean;
}) {
  return (
    <div className={`pointer-events-none absolute inset-0 z-20 overflow-hidden ${passThrough ? "label-pass" : ""}`}>
      {model.rooms.map(({ room }, i) => {
        const small = room.type === "closet";
        const selected = room.id === selectedId;
        const area = room.area_sqft_final ?? room.area_sqft;
        return (
          <button
            key={room.id}
            ref={(el) => {
              if (els.current) els.current[i] = el;
            }}
            type="button"
            onClick={() => onSelect(room.id)}
            style={{ opacity: 0 }}
            className={[
              "absolute left-0 top-0 whitespace-nowrap rounded-full border font-medium shadow-sm backdrop-blur transition-[opacity,background-color] duration-150 will-change-transform",
              small ? "px-1.5 py-px text-[10px]" : "px-2.5 py-0.5 text-xs",
              selected ? "border-teal-600 bg-teal-600 text-white" : "border-white/80 bg-white/85 text-slate-700 hover:bg-white",
            ].join(" ")}
          >
            {room.name}
            {area != null && <span className={selected ? "text-teal-50" : "text-slate-500"}> · {formatRoomArea(room, area)}</span>}
          </button>
        );
      })}
    </div>
  );
}
