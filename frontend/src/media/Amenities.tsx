import { useState } from "react";
import type { Amenity, MediaJob } from "./api";
import { MediaImg, PhotoViewer } from "./PhotoViewer";
import { GROUP_ORDER } from "./vocab";

const seen = (a: Amenity) => `Seen in ${a.evidence.length} photo${a.evidence.length === 1 ? "" : "s"}`;

function grouped(list: Amenity[]) {
  const groups = [...new Set([...GROUP_ORDER, ...list.map((a) => a.group)])];
  return groups.map((g) => [g, list.filter((a) => a.group === g)] as const).filter(([, l]) => l.length);
}

/** The first evidence photo, shown above a chip on hover. */
function Peek({ job, a }: { job: MediaJob; a: Amenity }) {
  const f = job.frames.find((x) => x.id === a.evidence[0]);
  if (!f) return null;
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-48 -translate-x-1/2 overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-slate-200 group-hover:block" role="tooltip">
      <MediaImg jobId={job.id} file={f.file} offline={job.offline} className="aspect-[4/3] w-full object-cover" />
      <span className="block px-2 py-1 text-[11px] text-slate-600">Photo {f.id}{a.evidence.length > 1 ? ` +${a.evidence.length - 1} more` : ""} · {seen(a)}</span>
    </span>
  );
}

/**
 * Amenity chips grouped like a listing site's filters. Hover shows the photo that proves it, click
 * opens every evidence photo. Editable (LeaseHub): ✓ confirms, × removes (with undo).
 */
export function AmenityChips({ job, amenities, editable = false, removed, confirmed, onToggleRemoved, onToggleConfirmed, tone = "blue" }: {
  job: MediaJob;
  amenities: Amenity[];
  editable?: boolean;
  removed?: Set<string>;
  confirmed?: Set<string>;
  onToggleRemoved?: (id: string) => void;
  onToggleConfirmed?: (id: string) => void;
  tone?: "blue" | "coral";
}) {
  const [open, setOpen] = useState<Amenity | null>(null);
  const shown = amenities.filter((a) => !removed?.has(a.id));
  const gone = amenities.filter((a) => removed?.has(a.id));
  const on = tone === "blue" ? "bg-blue-600 text-white ring-blue-600" : "bg-[#e8553e] text-white ring-[#e8553e]";
  const weakNote = editable && shown.some((a) => a.evidence.length === 1 && !confirmed?.has(a.id));
  return (
    <div className="space-y-3" data-amenities>
      {grouped(shown).map(([g, list]) => (
        <div key={g}>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g}</div>
          <div className="flex flex-wrap gap-1.5">
            {list.map((a) => {
              const ok = confirmed?.has(a.id);
              const weak = a.evidence.length === 1 && !ok;
              return (
                <span key={a.id} data-amenity={a.id}
                  className={`group relative inline-flex items-center rounded-full text-sm transition-colors ${ok ? `ring-1 ${on}` : weak && editable ? "border border-dashed border-slate-400 bg-white text-slate-700" : "bg-white text-slate-800 ring-1 ring-slate-300"}`}>
                  <Peek job={job} a={a} />
                  <button type="button" onClick={() => setOpen(a)} className="flex items-center gap-1.5 py-1 pl-3 pr-2 font-medium" title={`${seen(a)}${weak && editable ? ". Worth a quick check" : ""}`}>
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 opacity-60" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" /><circle cx="12" cy="13" r="3.2" /></svg>
                    {a.label}
                    {a.filter && <span className={`rounded px-1 text-[10px] font-semibold ${ok ? "bg-white/20" : "bg-emerald-50 text-emerald-700"}`} title="A common renter search filter">filter</span>}
                  </button>
                  {editable && (
                    <span className="flex items-center pr-1">
                      <button type="button" onClick={() => onToggleConfirmed?.(a.id)} aria-pressed={ok} aria-label={ok ? `Unconfirm ${a.label}` : `Confirm ${a.label}`}
                        className={`grid h-6 w-6 place-items-center rounded-full text-xs ${ok ? "hover:bg-white/20" : "text-emerald-700 hover:bg-emerald-50"}`}>✓</button>
                      <button type="button" onClick={() => onToggleRemoved?.(a.id)} aria-label={`Remove ${a.label}`}
                        className={`grid h-6 w-6 place-items-center rounded-full text-xs ${ok ? "hover:bg-white/20" : "text-slate-400 hover:bg-rose-50 hover:text-rose-700"}`}>✕</button>
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      ))}
      {weakNote && <p className="text-xs text-slate-500"><span className="inline-block h-3 w-5 rounded-full border border-dashed border-slate-400 align-middle" /> seen in one photo only: worth a quick check.</p>}
      {editable && gone.length > 0 && (
        <div className="text-xs text-slate-500">
          Removed:{" "}
          {gone.map((a, i) => (
            <span key={a.id}>
              {i > 0 && ", "}
              <span className="line-through">{a.label}</span>{" "}
              <button type="button" onClick={() => onToggleRemoved?.(a.id)} className="font-medium text-blue-700 hover:underline">undo</button>
            </span>
          ))}
        </div>
      )}
      {open && <PhotoViewer job={job} frameIds={open.evidence} title={`${open.label}: ${seen(open).toLowerCase()}`} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Small numbered thumbnails of every frame (walk order); click to view. */
export function PhotoStrip({ job, highlight, max }: { job: MediaJob; highlight?: number[]; max?: number }) {
  const [open, setOpen] = useState<number | null>(null);
  const frames = max ? job.frames.slice(0, max) : job.frames;
  const ids = job.frames.map((f) => f.id);
  return (
    <>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6" data-photo-strip>
        {frames.map((f) => {
          const tag = job.tags.find((t) => t.frame === f.id);
          const hl = highlight?.includes(f.id);
          return (
            <button key={f.id} type="button" onClick={() => setOpen(ids.indexOf(f.id))} title={tag?.caption || `Photo ${f.id}`}
              className={`relative overflow-hidden rounded-md bg-slate-100 ring-2 transition ${hl ? "ring-blue-500" : "ring-transparent hover:ring-slate-300"}`}>
              <MediaImg jobId={job.id} file={f.file} offline={job.offline} className="aspect-[4/3] w-full object-cover" />
              <span className="absolute left-1 top-1 rounded bg-slate-900/75 px-1 text-[10px] font-semibold text-white">{f.id}</span>
            </button>
          );
        })}
        {max && job.frames.length > max && (
          <button type="button" onClick={() => setOpen(max)} className="grid aspect-[4/3] place-items-center rounded-md bg-slate-100 text-xs font-medium text-slate-600 hover:bg-slate-200">
            +{job.frames.length - max} more
          </button>
        )}
      </div>
      {open !== null && <PhotoViewer job={job} frameIds={ids} start={open} title="Listing photos" onClose={() => setOpen(null)} />}
    </>
  );
}
