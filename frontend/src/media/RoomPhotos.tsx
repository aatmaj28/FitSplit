import { useState } from "react";
import type { MediaJob } from "./api";
import { MediaImg, PhotoViewer } from "./PhotoViewer";

/** A clicked room's photos from the listing video, in the 3D view's room panel. */
export function RoomPhotos({ job, frames, name }: { job: MediaJob; frames: number[] | undefined; name: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!frames?.length) return null;
  const shown = frames.slice(0, 4);
  return (
    <div className="mt-3" data-room-photos={frames.length}>
      <div className="mb-1 text-xs text-slate-500">Photos of this room</div>
      <div className="grid grid-cols-4 gap-1">
        {shown.map((f, i) => {
          const fr = job.frames.find((x) => x.id === f);
          return fr ? (
            <button key={f} type="button" onClick={() => setOpen(i)} className="relative overflow-hidden rounded-md ring-1 ring-slate-200 hover:ring-teal-500" aria-label={`Photo ${f}`}>
              <MediaImg jobId={job.id} file={fr.file} offline={job.offline} className="aspect-square w-full object-cover" />
              {i === 3 && frames.length > 4 && <span className="absolute inset-0 grid place-items-center bg-black/45 text-xs font-semibold text-white">+{frames.length - 4}</span>}
            </button>
          ) : null;
        })}
      </div>
      {open !== null && <PhotoViewer job={job} frameIds={frames} start={open} title={`${name}: photos`} onClose={() => setOpen(null)} />}
    </div>
  );
}
