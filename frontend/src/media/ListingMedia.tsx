import { useState } from "react";
import type { ListingMedia } from "../data/store";
import type { MediaJob } from "./api";
import { AmenityChips } from "./Amenities";
import { MediaImg, PhotoViewer } from "./PhotoViewer";
import { ROOM_LABEL } from "./vocab";

/** Amenities (each with the photo that shows it) and the description, as a listing page shows them. */
export function ListingAmenities({ media, job, tone = "coral" }: { media: ListingMedia; job: MediaJob; tone?: "blue" | "coral" }) {
  const kept = job.amenities.filter((a) => media.amenities.includes(a.id));
  const desc = media.description ?? job.description;
  const confirmed = new Set(media.confirmed);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" data-listing-media>
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Amenities</h2>
          <span className="text-xs text-slate-500">Each one links to the photo that shows it</span>
        </div>
        {kept.length ? <AmenityChips job={job} amenities={kept} confirmed={confirmed} tone={tone} /> : <p className="text-sm text-slate-500">No amenities tagged yet.</p>}
      </section>
      {desc && (desc.full || desc.short) && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" data-description>
          <h2 className="font-semibold text-slate-900">About this place</h2>
          {desc.short && <p className="mt-1 text-sm font-medium text-slate-800">{desc.short}</p>}
          {desc.full && <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-600">{desc.full.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}</div>}
        </section>
      )}
    </div>
  );
}

/** A photo tab: one big photo and numbered thumbnails, all opening the viewer. */
export function PhotoGallery({ job, className = "" }: { job: MediaJob; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [hero, setHero] = useState(0);
  const ids = job.frames.map((f) => f.id);
  const f = job.frames[hero];
  const tag = f && job.tags.find((t) => t.frame === f.id);
  if (!f) return null;
  return (
    <div className={`flex h-full flex-col gap-2 ${className}`} data-photo-gallery>
      <button type="button" onClick={() => setOpen(hero)} className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-slate-900">
        <MediaImg jobId={job.id} file={f.file} offline={job.offline} alt={tag?.caption ?? ""} className="absolute inset-0 h-full w-full object-cover" />
        <span className="absolute bottom-2 left-2 rounded-full bg-slate-900/75 px-2.5 py-1 text-xs font-medium text-white">
          {tag ? `${ROOM_LABEL[tag.room_type] ?? tag.room_type} · ` : ""}Photo {f.id} of {job.frames.length}
        </span>
      </button>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {job.frames.map((x, i) => (
          <button key={x.id} type="button" onClick={() => setHero(i)} aria-label={`Photo ${x.id}`}
            className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-md ring-2 ${i === hero ? "ring-[#e8553e]" : "ring-transparent hover:ring-slate-300"}`}>
            <MediaImg jobId={job.id} file={x.file} offline={job.offline} className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {open !== null && <PhotoViewer job={job} frameIds={ids} start={open} title="Photos" onClose={() => setOpen(null)} />}
    </div>
  );
}
