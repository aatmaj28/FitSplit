import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { LISTINGS, listing } from "../../data/listings";
import { demo, SYNDICATION, useDemo, type ListingMedia } from "../../data/store";
import { FloorPlan3D } from "../../components/FloorPlan3D";
import { estimateLabel, formatRoomArea } from "../../components/FloorPlan3D/theme";
import { checkFiles, createMediaJob, estimatedPlan, kindOf, layoutRects, listMediaJobs, MAX_UPLOAD_MB, PHOTO_ACCEPT, VIDEO_ACCEPT, type Amenity, type MediaJob, type MediaSummary } from "../../media/api";
import { AmenityChips, PhotoStrip } from "../../media/Amenities";
import { EngineBuilding, EngineCredit, LayoutEngineSwitch, useLayoutEngine } from "../../media/EngineSwitch";
import { useMediaJob } from "../../media/hooks";
import { RoomPhotos } from "../../media/RoomPhotos";
import { listingLook } from "../../media/style";
import { MediaImg } from "../../media/PhotoViewer";
import { filterPhrase, mentioned, ROOM_LABEL } from "../../media/vocab";
import { walkOf, Walkthrough } from "../../media/Walkthrough";
import { ErrorState, Spinner, ViewTabs } from "../ui";
import { L } from "./LeaseHubLayout";

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;
const field = "w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500";

/** The photo a listing card shows: a bright living room or kitchen if there is one. */
export function coverFrame(job: MediaJob): string | null {
  const score = (id: number) => {
    const t = job.tags.find((x) => x.frame === id);
    if (!t) return 0;
    return ((({ living: 3, kitchen: 2, bedroom: 1 }) as Record<string, number>)[t.room_type] ?? 0) + (t.natural_light === "bright" ? 0.5 : 0);
  };
  const best = [...job.frames].sort((a, b) => score(b.id) - score(a.id) || b.sharpness - a.sharpness)[0];
  return best?.file ?? null;
}

/** Bedrooms / bathrooms the photos show at least one of (rooms are counted properly once grouped). */
function roomGuess(job: MediaJob) {
  const rooms = (job as MediaJob & { rooms?: { type: string }[] }).rooms;
  const count = (t: string) => (rooms ? rooms.filter((r) => r.type === t).length : job.rooms_seen[t] ? 1 : 0);
  return { beds: Math.max(1, count("bedroom")), baths: Math.max(1, count("bathroom")) };
}

function DropZone({ files, setFiles, disabled }: { files: File[]; setFiles: (f: File[]) => void; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const add = (list: FileList | null) => list && !disabled && setFiles([...list]);
  const total = files.reduce((s, f) => s + f.size, 0);
  return (
    <div
      role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} data-media-drop
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !disabled && input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
      className={`rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition-colors ${
        disabled ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400" : "cursor-pointer border-slate-300 bg-white text-slate-600 hover:border-blue-500 hover:text-blue-700"
      } ${over ? "border-blue-500 bg-blue-50" : ""}`}
    >
      <input ref={input} type="file" multiple accept={`${VIDEO_ACCEPT},${PHOTO_ACCEPT}`} className="hidden" onChange={(e) => add(e.target.files)} data-media-input />
      <svg viewBox="0 0 24 24" className="mx-auto mb-2 h-8 w-8 opacity-70" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" strokeLinejoin="round" />
      </svg>
      {files.length ? (
        <div className="space-y-0.5">
          <div className="font-medium text-slate-800">{files.length === 1 ? files[0].name : `${files.length} ${kindOf(files[0]) === "video" ? "files" : "photos"}`}</div>
          <div className="text-xs text-slate-500">{mb(total)} · click to choose again</div>
        </div>
      ) : (
        <>
          <div className="font-medium">{disabled ? "Uploads are unavailable right now" : "Drop a walkthrough video or listing photos"}</div>
          <div className="mt-0.5 text-xs text-slate-400">One video (.mov, .mp4, iPhone HEVC) or several photos (.jpg, .heic) · up to {MAX_UPLOAD_MB} MB</div>
        </>
      )}
    </div>
  );
}

function JobProgress({ job, started }: { job: MediaJob | null; started: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const steps = job?.steps.filter((s) => s.status !== "skipped") ?? [];
  return (
    <div className="space-y-3 rounded-xl bg-blue-50/70 p-4 ring-1 ring-blue-100" aria-live="polite" data-media-progress>
      <div className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-blue-100">
        <div className="h-full rounded-full bg-blue-600 transition-[width] duration-500" style={{ width: `${Math.round((job?.progress ?? 0.02) * 100)}%` }} />
      </div>
      <ol className="space-y-2">
        {steps.map((s) => (
          <li key={s.id} className="flex items-start gap-2.5 text-sm" data-step={s.id} data-status={s.status}>
            {s.status === "done" ? (
              <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500 text-[11px] font-bold text-white" aria-hidden>✓</span>
            ) : s.status === "running" ? (
              <span className="mt-px h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" aria-hidden />
            ) : s.status === "error" ? (
              <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-rose-500 text-[11px] font-bold text-white" aria-hidden>!</span>
            ) : (
              <span className="mt-px h-5 w-5 shrink-0 rounded-full border-2 border-slate-200" aria-hidden />
            )}
            <span className="min-w-0">
              <span className={s.status === "pending" ? "text-slate-400" : s.status === "running" ? "font-semibold text-slate-900" : "text-slate-700"}>{s.label}</span>
              {s.detail && s.status !== "pending" && <span className="block text-xs text-slate-500">{s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      <div className="text-xs tabular-nums text-slate-400">{Math.floor((now - started) / 1000)} s</div>
    </div>
  );
}

function Recent({ jobs, onPick, disabled }: { jobs: MediaSummary[]; onPick: (id: string) => void; disabled: boolean }) {
  if (!jobs.length) return <p className="text-sm text-slate-500">Videos you've processed before show up here and open instantly.</p>;
  return (
    <div className="grid grid-cols-2 gap-2">
      {jobs.slice(0, 6).map((j) => (
        <button key={j.id} type="button" disabled={disabled} onClick={() => onPick(j.id)} data-media-job={j.id}
          className="overflow-hidden rounded-xl bg-white text-left ring-1 ring-slate-200 transition hover:ring-blue-400 disabled:opacity-50">
          {j.cover ? <MediaImg jobId={j.id} file={j.cover} className="aspect-[4/3] w-full object-cover" /> : <div className="aspect-[4/3] bg-slate-100" />}
          <div className="px-2 py-1.5">
            <div className="truncate text-xs font-medium text-slate-800">{j.title}</div>
            <div className="truncate text-[11px] text-slate-400">{j.frames} photos kept · {j.created?.slice(0, 10)}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

// callout order: the filters renters tend to treat as must-haves first (our judgement, not data)
const FILTER_PRIORITY = ["in_unit_laundry", "dishwasher", "central_ac", "window_ac", "washer_dryer_hookups", "balcony", "walk_in_closet", "hardwood_floors", "fireplace", "furnished"];

/** "Missing from your listing": what the photos found that the listing doesn't say yet. */
function MissingCallout({ job, kept, existing }: { job: MediaJob; kept: Amenity[]; existing: Set<string> }) {
  const missing = kept.filter((a) => !existing.has(a.id));
  const byPhrase = new Map<string, Amenity>();
  const rank = (id: string) => (FILTER_PRIORITY.indexOf(id) + 1 || 99);
  for (const a of [...missing].filter((x) => x.filter).sort((x, y) => rank(x.id) - rank(y.id) || y.evidence.length - x.evidence.length)) {
    const p = filterPhrase(a.id, a.label);
    if (!byPhrase.has(p)) byPhrase.set(p, a);
  }
  const lines = [...byPhrase.entries()];
  const n = lines.length;
  return (
    <section className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200" data-missing>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-amber-950">Missing from your listing</h2>
        <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200" data-filter-count={n}>
          {n ? `This listing now matches ${n} more common renter filter${n === 1 ? "" : "s"}` : "No new renter filters"}
        </span>
      </div>
      {n ? (
        <ul className="mt-2 space-y-2">
          {lines.slice(0, 4).map(([phrase, a]) => {
            const f = job.frames.find((x) => x.id === a.evidence[0]);
            return (
              <li key={a.id} className="flex items-center gap-3 text-sm text-amber-950">
                {f && <MediaImg jobId={job.id} file={f.file} offline={job.offline} className="h-10 w-14 shrink-0 rounded object-cover ring-1 ring-amber-200" />}
                <span><span className="font-semibold">{a.label}</span> found in photo {a.evidence[0]}. Renters filtering for {phrase} would have missed you.</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-amber-900">Your listing already mentions every filter amenity the photos show{missing.length ? `; the photos add ${missing.length} more detail${missing.length === 1 ? "" : "s"}` : ""}.</p>
      )}
      {missing.length > lines.length && n > 0 && <p className="mt-2 text-xs text-amber-800">Also new: {missing.filter((a) => !lines.some(([, x]) => x.id === a.id)).map((a) => a.label).join(", ")}.</p>}
    </section>
  );
}

export default function NewListingMedia({ offline }: { offline: boolean | null }) {
  const { listings } = useDemo();
  const [files, setFiles] = useState<File[]>([]);
  const [listingFor, setListingFor] = useState("");
  const [text, setText] = useState("");
  const [showText, setShowText] = useState(false);
  const [upload, setUpload] = useState<{ frac: number; started: number } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [started, setStarted] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<MediaSummary[]>([]);
  const { job, error: pollError, kick } = useMediaJob(jobId);
  const [engine, setEngine] = useLayoutEngine(job);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [desc, setDesc] = useState<{ full: string; short: string } | null>(null);
  const [form, setForm] = useState({ title: "", location: "Boston, MA", rent: 0, beds: 1, baths: 1, sqft: 0 });
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(0);
  const [tab, setTab] = useState<"amenities" | "walk" | "plan">("amenities");

  useEffect(() => {
    listMediaJobs().then((r) => setRecent(r.jobs)).catch(() => {});
  }, [job?.status]);
  // a finished job fills the editor once
  const filled = useRef<string | null>(null);
  useEffect(() => {
    if (!job || job.status !== "complete" || filled.current === job.id) return;
    filled.current = job.id;
    setRemoved(new Set());
    setConfirmed(new Set());
    setDesc(job.description ? { full: job.description.full, short: job.description.short } : { full: "", short: "" });
    setForm((f) => ({ ...f, ...roomGuess(job), title: f.title || (listingFor ? listing(listingFor)?.title ?? "" : "") }));
  }, [job, listingFor]);
  useEffect(() => {
    if (!publishing || published >= SYNDICATION.length) return;
    const t = setTimeout(() => setPublished((n) => n + 1), 450);
    return () => clearTimeout(t);
  }, [publishing, published]);

  const attached = listings.find((a) => a.id === listingFor);
  const existing = useMemo(() => new Set([...mentioned(text), ...(attached?.media?.amenities ?? [])]), [text, attached]);
  const problem = files.length ? checkFiles(files) : null;

  const start = async () => {
    if (checkFiles(files)) return;
    setError(null);
    setStarted(Date.now());
    setUpload({ frac: 0, started: Date.now() });
    try {
      const j = await createMediaJob(files, { listingId: listingFor || null, existing: [...existing] }, (frac) => setUpload((u) => u && { ...u, frac }));
      filled.current = null;
      setJobId(j.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUpload(null);
    }
  };
  const open = (id: string) => {
    setError(null);
    setStarted(Date.now());
    filled.current = null;
    setJobId(id);
  };
  const reset = () => {
    setJobId(null);
    setFiles([]);
    setPublishing(false);
    setPublished(0);
    setDesc(null);
  };
  const toggle = (set: Set<string>, upd: (s: Set<string>) => void) => (id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    upd(next);
  };

  const done = job?.status === "complete";
  const kept = done ? job.amenities.filter((a) => !removed.has(a.id)) : [];
  const newId = job ? `media_${job.id.slice(3)}` : "";
  const targetId = listingFor || newId;
  const publish = () => {
    if (!job || !done) return;
    const media: ListingMedia = { jobId: job.id, amenities: kept.map((a) => a.id), confirmed: [...confirmed].filter((id) => !removed.has(id)), description: desc, cover: coverFrame(job) };
    if (attached) demo.publish({ ...attached, media });
    else {
      const prior = listings.find((a) => a.id === newId);
      demo.publish({
        id: newId, status: "published", publishedAt: new Date().toISOString().slice(0, 10), syndicated: SYNDICATION, views3d: prior?.views3d ?? 0,
        custom: { title: form.title, location: form.location, rent: form.rent, beds: form.beds, baths: form.baths, sqft: form.sqft }, media,
      });
    }
    setPublishing(true);
  };
  const canPublish = done && (attached ? true : form.title.trim() !== "" && form.rent > 0);

  // ---- picking / uploading / processing
  if (!jobId || !job || job.status !== "complete") {
    const busy = Boolean(upload) || Boolean(jobId);
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="font-semibold text-slate-900">1. Video or photos</h2>
          {!busy && (
            <>
              <DropZone files={files} setFiles={setFiles} disabled={offline === true} />
              {problem && <p className="text-sm text-rose-700">{problem}</p>}
              <label className="block text-xs font-medium text-slate-600">
                Which listing is this for?
                <select className={field} value={listingFor} onChange={(e) => setListingFor(e.target.value)} data-media-for>
                  <option value="">A new listing</option>
                  {LISTINGS.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </label>
              {showText ? (
                <label className="block text-xs font-medium text-slate-600">
                  Your current listing text <span className="font-normal text-slate-400">(we flag what the photos show that it doesn't mention)</span>
                  <textarea className={`${field} h-24`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Sunny 2 bed near the T. Hardwood floors, heat and hot water included…" data-media-text />
                  {text && <span className="mt-1 block font-normal text-slate-500">Mentions: {[...mentioned(text)].length ? mentioned(text).join(", ").replace(/_/g, " ") : "no amenities we track"}</span>}
                </label>
              ) : (
                <button type="button" onClick={() => setShowText(true)} className="text-xs font-medium text-blue-700 hover:underline">+ Compare with my current listing text</button>
              )}
              <button type="button" onClick={start} disabled={!files.length || Boolean(problem) || offline === true} className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold ${L.primary} disabled:opacity-50`} data-media-start>
                Tag photos and write the description
              </button>
            </>
          )}
          {upload && (
            <div className="space-y-2 rounded-xl bg-blue-50/70 p-4 ring-1 ring-blue-100" aria-live="polite">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-800"><Spinner className="h-4 w-4 text-blue-600" /> Uploading {files.length === 1 ? files[0].name : `${files.length} photos`}… {Math.round(upload.frac * 100)}%</div>
              <div className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-blue-100"><div className="h-full bg-blue-600 transition-[width]" style={{ width: `${Math.round(upload.frac * 100)}%` }} /></div>
            </div>
          )}
          {jobId && <JobProgress job={job} started={started} />}
          {job?.status === "error" && (
            <ErrorState title="Couldn't finish this video" onRetry={files.length ? start : undefined}>{job.error}</ErrorState>
          )}
          {(error || (pollError && !job)) && <ErrorState title="Upload failed">{error ?? pollError}</ErrorState>}
          <p className="text-xs text-slate-500">We keep about 2 sharp frames per second, drop blurry and repeated ones, and tag up to 50 in walk order: room, amenities, floors, wall color, light. A video you've uploaded before comes back instantly.</p>
        </section>
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="font-semibold text-slate-900">Or open a recent video</h2>
          <Recent jobs={recent} onPick={open} disabled={busy} />
        </section>
      </div>
    );
  }

  // ---- results
  const ready = publishing && published >= SYNDICATION.length;
  const rooms = Object.entries(job.rooms_seen).filter(([t]) => t !== "other").sort((a, b) => b[1] - a[1]);
  const walk = walkOf(job);
  const nRooms = job.rooms?.length ?? 0;
  const est = estimatedPlan(job, undefined, engine);
  const anyPlan = estimatedPlan(job);
  return (
    <div className="space-y-4" data-media-results={job.id}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
          {job.frames.length} photos tagged · {job.amenities.length} amenities found{nRooms ? ` · ${nRooms} rooms` : ""}
        </span>
        <span className="text-xs text-slate-500">from {job.inputs.length === 1 ? job.inputs[0].name : job.inputs.length ? `${job.inputs[0].name} and ${job.inputs.length - 1} more` : "a walkthrough video"}</span>
        <button type="button" onClick={reset} className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-800">Use another video</button>
      </div>
      <MissingCallout job={job} kept={kept} existing={existing} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <ViewTabs value={tab} onChange={setTab} tabs={[
            { id: "amenities" as const, label: "Amenities" },
            ...(walk ? [{ id: "walk" as const, label: `Walkthrough · ${walk.rooms.length} rooms` }] : []),
            ...(anyPlan ? [{ id: "plan" as const, label: "Floor plan" }] : []),
          ]} />
          {tab === "plan" && anyPlan ? (
            <div className="space-y-3" data-estimated-plan>
              <LayoutEngineSwitch job={job} engine={engine} onChange={setEngine} onAsked={kick} />
              {!est ? <EngineBuilding job={job} engine={engine} /> : (<>
              <div className="relative h-[56vh] min-h-[380px]"><FloorPlan3D key={engine} plan={est.plan} imageUrl={est.imageUrl} initialView="top" initialLivedIn roomStyle={listingLook(est.plan, job).styles}
                roomExtra={(room) => <RoomPhotos job={job} frames={listingLook(est.plan, job).frames[room.id]} name={room.name} />} /></div>
              <EngineCredit plan={est.plan} />
              <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold text-slate-900">Room sizes</h2>
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">{estimateLabel(est.plan)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Each room is measured against objects of known size in its photos (doors, appliances, fixtures, beds). Where rooms sit is schematic: worked out from which rooms connect.</p>
                {est.plan.notes ? <p className="mt-1 text-xs text-slate-500"><span className="font-medium text-slate-600">What the video can't confirm:</span> {est.plan.notes}</p> : null}
                <table className="mt-2 w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {est.plan.rooms.map((r) => (
                      <tr key={r.id} title={r.dims_confidence?.reasoning}>
                        <td className="py-1.5 text-slate-800">{r.name}<span className="ml-1.5 text-xs text-slate-400">{r.dims_confidence?.confidence} confidence</span></td>
                        <td className="py-1.5 text-right text-xs text-slate-500">{r.printed_dims_text} ±{r.dims_confidence?.plus_minus_pct}%</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-800">{formatRoomArea(r, r.area_sqft_final)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              </>)}
            </div>
          ) : tab === "walk" && walk ? (
            <div className="space-y-2">
              <div className="h-[60vh] min-h-[380px]"><Walkthrough job={job} walk={walk} rects={layoutRects(job, engine)} /></div>
              <p className="text-xs text-slate-500">
                {walk.rooms.filter((r) => r.pano).length} of {walk.rooms.length} rooms stitched into panoramas; the others show their photos. Rooms and doors come from the walk order and one AI check of the photos.
              </p>
            </div>
          ) : (<>
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-slate-900">Amenities found in the photos</h2>
              <span className="text-xs text-slate-500">Hover for the photo · ✓ confirm · ✕ remove</span>
            </div>
            {job.amenities.length ? (
              <AmenityChips job={job} amenities={job.amenities} editable removed={removed} confirmed={confirmed}
                onToggleRemoved={toggle(removed, setRemoved)} onToggleConfirmed={toggle(confirmed, setConfirmed)} />
            ) : (
              <p className="text-sm text-slate-500">No amenities from our list are clearly visible in these photos.</p>
            )}
          </section>
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-slate-900">Photos, in walk order</h2>
              <span className="text-xs text-slate-500">{rooms.map(([t, n]) => `${ROOM_LABEL[t] ?? t} ${n}`).join(" · ")}</span>
            </div>
            <PhotoStrip job={job} max={23} />
          </section>
          </>)}
        </div>
        <section className="space-y-4 self-start rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-semibold text-slate-900">Description</h2>
              {job.description && desc && (desc.full !== job.description.full || desc.short !== job.description.short) && (
                <button type="button" onClick={() => setDesc({ full: job.description!.full, short: job.description!.short })} className="text-xs font-medium text-blue-700 hover:underline">Undo my edits</button>
              )}
            </div>
            <p className="text-xs text-slate-500">Written from what the photos show, nothing else. Edit freely.</p>
            <label className="mt-2 block text-xs font-medium text-slate-600">
              Full
              <textarea className={`${field} h-40 leading-relaxed`} value={desc?.full ?? ""} onChange={(e) => setDesc((d) => ({ short: d?.short ?? "", full: e.target.value }))} data-desc-full />
              <span className="font-normal text-slate-400">{(desc?.full ?? "").split(/\s+/).filter(Boolean).length} words</span>
            </label>
            <label className="mt-2 block text-xs font-medium text-slate-600">
              Short, for listing sites
              <textarea className={`${field} h-16`} value={desc?.short ?? ""} onChange={(e) => setDesc((d) => ({ full: d?.full ?? "", short: e.target.value }))} data-desc-short />
              <span className="font-normal text-slate-400">{(desc?.short ?? "").length} characters</span>
            </label>
          </div>
          {attached ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 ring-1 ring-slate-200">Adds these amenities, the description and the photos to <span className="font-semibold text-slate-900">{listing(attached.id)?.title ?? attached.custom?.title}</span>.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 text-xs font-medium text-slate-600">Title<input className={field} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Sunny 2 bed in Mission Hill" data-media-title /></label>
              <label className="col-span-2 text-xs font-medium text-slate-600">Location<input className={field} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
              {(["rent", "sqft", "beds", "baths"] as const).map((k) => (
                <label key={k} className="text-xs font-medium text-slate-600">
                  {{ rent: "Rent ($/mo)", sqft: "Total sq ft (optional)", beds: "Bedrooms", baths: "Bathrooms" }[k]}
                  {k === "sqft" && est?.plan.unit.total_sqft ? <span className="ml-1 font-normal text-amber-700" title={estimateLabel(est.plan)}>≈ {est.plan.unit.total_sqft} from photos</span> : null}
                  <input type="number" min={0} step={k === "baths" ? 0.5 : 1} className={field} value={form[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} data-media-field={k} />
                </label>
              ))}
            </div>
          )}
          {!publishing ? (
            <button type="button" onClick={publish} disabled={!canPublish} className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold ${L.primary} disabled:opacity-50`} data-media-publish>
              Publish listing
            </button>
          ) : (
            <div className="space-y-3" aria-live="polite">
              <div className="flex flex-wrap gap-2">
                {SYNDICATION.map((s, i) => (
                  <span key={s} className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${i < published ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"}`}>
                    {i < published ? `Syndicated to ${s} ✓` : `${s}…`}
                  </span>
                ))}
              </div>
              {ready && (
                <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 ring-1 ring-emerald-200" data-media-published>
                  Published with {kept.length} tagged amenities and {job.frames.length} photos.
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link to={`/leasehub/listings/${targetId}`} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${L.primary}`}>Open the listing</Link>
                    <Link to={`/roombae/listings/${targetId}`} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-300">See it on Roombae</Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
