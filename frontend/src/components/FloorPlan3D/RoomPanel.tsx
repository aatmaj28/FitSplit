import type { ParsedPlan, Room } from "../../types";
import { ROOM_COLORS, ROOM_LABELS, formatSqft } from "./theme";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 sm:py-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{children}</dd>
    </div>
  );
}

/** Details for the clicked room: a side panel on desktop, a bottom sheet on phones. */
export function RoomPanel({ room, plan, onClose, onSelect, compact = false, children }: {
  room: Room;
  plan: ParsedPlan;
  onClose: () => void;
  onSelect: (id: string) => void;
  /** editing the layout: keep the room facts short, furniture tools go in `children` */
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const closets = (room.closet_ids ?? []).map((id) => plan.rooms.find((r) => r.id === id)).filter((r): r is Room => !!r);
  const approx = room.segmentation === "split";
  return (
    <aside
      className="absolute inset-x-2 bottom-2 z-40 max-h-[42%] overflow-y-auto rounded-2xl bg-white/95 p-3 text-xs shadow-xl ring-1 ring-slate-200 backdrop-blur sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-16 sm:max-h-[calc(100%-5rem)] sm:w-72 sm:p-4 sm:text-sm"
      aria-label={`${room.name} details`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{room.name}</h2>
          <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            <span className="h-2 w-2 rounded-full" style={{ background: ROOM_COLORS[room.type] }} />
            {ROOM_LABELS[room.type] ?? room.type}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 -mt-1 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M5.3 5.3a1 1 0 0 1 1.4 0L10 8.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 10l3.3 3.3a1 1 0 0 1-1.4 1.4L10 11.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 10 5.3 6.7a1 1 0 0 1 0-1.4Z" />
          </svg>
        </button>
      </div>

      <dl className="mt-2 divide-y divide-slate-100 sm:mt-3">
        <Row label="Area">
          <span className="text-teal-700">{formatSqft(room.area_sqft_final)}</span>
          {room.area_source && <span className="ml-1 text-xs font-normal text-slate-400">({room.area_source})</span>}
        </Row>
        {!compact && room.area_source === "printed" && <Row label="Measured">{formatSqft(room.area_sqft)}</Row>}
        {!compact && <Row label="Printed dims">{room.printed_dims_text ?? "not printed"}</Row>}
        {!compact && room.type === "bedroom" && (
          <>
            <Row label="Private bath">
              {room.has_private_bath ? <span className="text-teal-700">Yes</span> : "No"}
            </Row>
            <Row label="With closets">{formatSqft(room.area_with_closets_sqft)}</Row>
          </>
        )}
      </dl>

      {!compact && closets.length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-slate-500">Closets</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {closets.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-teal-50 hover:text-teal-800"
              >
                {c.name} · {formatSqft(c.area_sqft)}
              </button>
            ))}
          </div>
        </div>
      )}
      {!compact && approx && (
        <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          Shares an open area with other rooms; the measured area is an estimate.
        </p>
      )}
      {children}
    </aside>
  );
}
