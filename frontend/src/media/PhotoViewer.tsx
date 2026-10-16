import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { API, DEMO } from "../api";
import { type MediaJob } from "./api";
import { ROOM_LABEL } from "./vocab";

/** A job file from the backend, falling back to the bundled copy (and the other way round). */
export function MediaImg({ jobId, file, offline, alt = "", className, ...rest }: {
  jobId: string; file: string; offline?: boolean; alt?: string; className?: string;
} & Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src">) {
  const live = `${API}/api/media/jobs/${jobId}/files/${file}`;
  const bundle = `${DEMO}/media/${jobId}/${file}`;
  return (
    <img src={offline ? bundle : live} alt={alt} className={className} loading="lazy" draggable={false}
      onError={(e) => {
        const img = e.currentTarget;
        const next = img.src.endsWith(bundle) ? live : bundle;
        if (!img.dataset.retried) {
          img.dataset.retried = "1";
          img.src = next;
        }
      }}
      {...rest} />
  );
}

const clock = (t: number | null) => (t == null ? null : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`);

/** Full-size photos of a job (the evidence for an amenity, or every frame), with arrows and Esc. */
export function PhotoViewer({ job, frameIds, start = 0, title, onClose }: {
  job: MediaJob; frameIds: number[]; start?: number; title?: string; onClose: () => void;
}) {
  const [i, setI] = useState(start);
  const n = frameIds.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setI((x) => (x + 1) % n);
      else if (e.key === "ArrowLeft") setI((x) => (x - 1 + n) % n);
      else return;
      e.preventDefault();
      e.stopPropagation(); // keep the step bar / 3D viewer from reacting too
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [n, onClose]);
  const id = frameIds[i];
  const frame = job.frames.find((f) => f.id === id);
  const tag = job.tags.find((t) => t.frame === id);
  if (!frame) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true"
      aria-label={title ?? "Photos"} onClick={onClose} data-photo-viewer>
      <div className="relative flex max-h-full w-full max-w-5xl flex-col gap-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 text-sm text-white">
          <div className="min-w-0">
            {title && <div className="truncate font-semibold">{title}</div>}
            <div className="text-xs text-slate-300">
              Photo {id}{tag ? ` · ${ROOM_LABEL[tag.room_type] ?? tag.room_type}` : ""}{clock(frame.t) ? ` · ${clock(frame.t)} in the video` : ""}
              {n > 1 ? ` · ${i + 1} of ${n}` : ""}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium hover:bg-white/20" aria-label="Close">Close ✕</button>
        </div>
        <div className="relative overflow-hidden rounded-xl bg-black">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <MediaImg jobId={job.id} file={frame.file} offline={job.offline} alt={tag?.caption || `Photo ${id}`} className="mx-auto max-h-[72vh] w-auto object-contain" />
            </motion.div>
          </AnimatePresence>
          {n > 1 && (
            <>
              <button type="button" aria-label="Previous photo" onClick={() => setI((x) => (x - 1 + n) % n)}
                className="absolute left-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-xl text-white hover:bg-black/70">‹</button>
              <button type="button" aria-label="Next photo" onClick={() => setI((x) => (x + 1) % n)}
                className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-xl text-white hover:bg-black/70">›</button>
            </>
          )}
        </div>
        {tag && (tag.caption || tag.amenities.length > 0) && (
          <div className="text-xs text-slate-300">
            {tag.caption}
            {tag.condition ? <span className="text-slate-400"> · {tag.condition}</span> : null}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
