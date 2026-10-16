/**
 * Media jobs (listing video / photos -> tags, amenities, description, walkthrough, estimated plan).
 * Live: the backend's /api/media/jobs. Offline: jobs bundled under public/demo/media/<id>/.
 */
import { API, DEMO, fetchJson } from "../api";
import { planSource } from "../data/plans";
import type { ParsedPlan } from "../types";

export type StepStatus = "pending" | "running" | "done" | "skipped" | "error";

export interface MediaFrame {
  id: number;
  file: string; // "frames/f001.jpg", relative to the job
  t: number | null; // seconds into the video
  source: string;
  sharpness: number;
  hash: string;
  width: number;
  height: number;
}

export interface FrameTag {
  frame: number;
  room_type: string;
  amenities: string[];
  flooring: string;
  wall_color: string | null;
  natural_light: "bright" | "some" | "dim";
  windows: number;
  condition: string;
  objects: string[];
  caption: string;
}

export interface Amenity {
  id: string;
  label: string;
  group: string;
  filter: boolean; // a common renter search filter (curated)
  confidence: number;
  evidence: number[]; // frame ids
}

export interface MediaJob {
  id: string;
  status: "queued" | "running" | "complete" | "error";
  step: string | null;
  progress: number;
  steps: { id: string; label: string; status: StepStatus; detail: string }[];
  listing_id: string | null;
  inputs: { name: string; bytes: number; kind: "video" | "photo"; sha256: string }[];
  frames: MediaFrame[];
  tags: FrameTag[];
  amenities: Amenity[];
  rooms_seen: Record<string, number>;
  description: { full: string; short: string; source: string } | null;
  insight: { new_tags: string[]; new_filter_matches: number; filters: string[] } | null;
  error: string | null;
  created: string;
  finished: string | null;
  offline?: boolean; // loaded from the bundle
  rooms?: { id: string; name: string; type: string; frames: number[]; dims?: { w: number; l: number; plus_minus_pct: number; confidence: string } }[];
  /** the default engine's estimated floor plan (parsed-plan format, layout_source "estimated_from_photos") */
  plan?: ParsedPlan | null;
  /** the default engine's room rectangles in feet (jobs from before the engines: FitSplit's, by walkthrough room) */
  layout?: Record<string, { x: number; y: number; w: number; h: number }> | null;
  /** the engine new jobs build first, and every engine's plan built so far */
  layout_engine?: LayoutEngine;
  plans?: Partial<Record<LayoutEngine, ParsedPlan>>;
  /** per engine: room rectangles (feet) and which walkthrough room sits in which of its rooms */
  layouts?: Partial<Record<LayoutEngine, { rects: Record<string, { x: number; y: number; w: number; h: number }>; walk: Record<string, string> }>>;
  engine_status?: Partial<Record<LayoutEngine, string>>;
}

export type LayoutEngine = "combined" | "tanvi" | "fitsplit";
export const ENGINES: { id: LayoutEngine; label: string; credit: string }[] = [
  { id: "combined", label: "Combined", credit: "Layout engine by Tanvi Deshpande and Aatmaj Salunke" },
  { id: "tanvi", label: "Tanvi's", credit: "Layout engine by Tanvi Deshpande" },
  { id: "fitsplit", label: "FitSplit", credit: "Layout engine by Aatmaj Salunke" },
];

/** The engine whose plan a job shows first (jobs from before the engines only have FitSplit's). */
export function defaultEngine(job: MediaJob | null): LayoutEngine {
  return job?.layout_engine && job.plans?.[job.layout_engine] ? job.layout_engine : "fitsplit";
}

/** Ask the backend to build another engine's plan for a finished job (the switch polls for it). */
export async function buildEngine(jobId: string, engine: LayoutEngine): Promise<MediaJob> {
  return fetchJson<MediaJob>(`${API}/api/media/jobs/${jobId}/engines/${engine}`, { method: "POST" }, 15000);
}

export interface MediaSummary {
  id: string;
  title: string;
  inputs: string;
  frames: number;
  cover: string | null;
  created: string;
}

export const VIDEO_ACCEPT = ".mov,.mp4,.m4v,.webm,video/*";
export const PHOTO_ACCEPT = ".jpg,.jpeg,.png,.heic,.heif,.webp,image/*";
export const MAX_UPLOAD_MB = 500;
const VIDEO_EXT = /\.(mov|mp4|m4v|webm|avi|mkv|3gp|hevc)$/i;
const PHOTO_EXT = /\.(jpe?g|png|heic|heif|webp|bmp|tiff?)$/i;

export function kindOf(f: File): "video" | "photo" | null {
  return VIDEO_EXT.test(f.name) ? "video" : PHOTO_EXT.test(f.name) ? "photo" : null;
}

/** "One video, or several photos", with the reason when the selection doesn't work. */
export function checkFiles(files: File[]): string | null {
  if (!files.length) return "Pick a video or some photos";
  const kinds = files.map(kindOf);
  if (kinds.includes(null)) return `Not a video or photo: ${files.filter((_, i) => !kinds[i]).map((f) => f.name).slice(0, 2).join(", ")}`;
  if (kinds.includes("video") && files.length > 1) return "Upload one video, or several photos";
  const mb = files.reduce((s, f) => s + f.size, 0) / 1024 / 1024;
  if (mb > MAX_UPLOAD_MB) return `That's ${Math.round(mb)} MB; the limit is ${MAX_UPLOAD_MB} MB`;
  return null;
}

/** POST the files with upload progress (fetch can't report it). */
export function createMediaJob(files: File[], opts: { listingId?: string | null; existing?: string[] }, onProgress: (frac: number) => void): Promise<MediaJob> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    for (const f of files) body.append("files", f, f.name);
    if (opts.listingId) body.append("listing_id", opts.listingId);
    if (opts.existing?.length) body.append("existing_amenities", opts.existing.join(","));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}/api/media/jobs`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as MediaJob);
      else {
        const d = (data as { detail?: unknown } | null)?.detail;
        reject(new Error(typeof d === "string" ? d : `${xhr.status} ${xhr.statusText}`));
      }
    };
    xhr.onerror = () => reject(new Error("The upload didn't reach the server"));
    xhr.send(body);
  });
}

async function bundled(id: string): Promise<MediaJob> {
  return { ...(await fetchJson<MediaJob>(`${DEMO}/media/${id}/job.json`)), offline: true };
}

/** A job from the backend, or from the bundle when the backend is offline (or doesn't have it). */
export async function getMediaJob(id: string): Promise<MediaJob> {
  const { offline } = await planSource();
  if (offline) return bundled(id);
  try {
    return await fetchJson<MediaJob>(`${API}/api/media/jobs/${encodeURIComponent(id)}`);
  } catch (e) {
    return bundled(id).catch(() => Promise.reject(e));
  }
}

/** Finished jobs to pick from: the backend's, plus the bundled demo video (so a fresh checkout
 *  offers it too; it opens from the bundle when the backend doesn't have it). */
export async function listMediaJobs(): Promise<{ jobs: MediaSummary[]; offline: boolean }> {
  const { offline } = await planSource();
  const bundled = await fetchJson<MediaSummary[]>(`${DEMO}/media/index.json`).catch(() => [] as MediaSummary[]);
  if (!offline) {
    try {
      const live = await fetchJson<MediaSummary[]>(`${API}/api/media/jobs`);
      return { jobs: [...live, ...bundled.filter((b) => !live.some((j) => j.id === b.id))], offline: false };
    } catch {
      /* fall through to the bundle */
    }
  }
  return { jobs: bundled, offline: true };
}

/** URL of a job file ("frames/f001.jpg", "plan/plan.svg", ...). */
export function mediaUrl(job: Pick<MediaJob, "id" | "offline">, file: string): string {
  return job.offline ? `${DEMO}/media/${job.id}/${file}` : `${API}/api/media/jobs/${job.id}/files/${file}`;
}

export function frameUrl(job: Pick<MediaJob, "id" | "offline" | "frames">, frameId: number): string | undefined {
  const f = job.frames.find((x) => x.id === frameId);
  return f && mediaUrl(job, f.file);
}

const planCache = new WeakMap<ParsedPlan, Map<number, { plan: ParsedPlan; imageUrl: string }>>();

/** One engine's estimated floor plan of a job (default: the job's own), ready for <FloorPlan3D>
 *  (its 2D drawing is the overlay). Cached per plan and rent: the viewer and the rent split reset
 *  whenever they get a new plan object. */
export function estimatedPlan(job: MediaJob | null, rent?: number, engine?: LayoutEngine): { plan: ParsedPlan; imageUrl: string } | null {
  const fromEngine = engine ? job?.plans?.[engine] : undefined;
  const plan = fromEngine ?? (engine && job?.plans && engine !== defaultEngine(job) ? undefined : job?.plan);
  if (!job || !plan) return null;
  let byRent = planCache.get(plan);
  if (!byRent) planCache.set(plan, (byRent = new Map()));
  const key = rent ?? 0;
  if (!byRent.has(key)) {
    const image = fromEngine ? `plan/${engine}.png` : "plan/plan.png";
    byRent.set(key, { plan: rent ? { ...plan, unit: { ...plan.unit, rent } } : plan, imageUrl: mediaUrl(job, image) });
  }
  return byRent.get(key)!;
}

/** Room rectangles for the walkthrough minimap, each with the walkthrough rooms inside it. */
export function layoutRects(job: MediaJob | null, engine?: LayoutEngine) {
  const lay = engine ? job?.layouts?.[engine] : undefined;
  if (lay) {
    return Object.entries(lay.rects).map(([id, r]) => ({ id, ...r, walkIds: Object.keys(lay.walk).filter((w) => lay.walk[w] === id) }));
  }
  return job?.layout ? Object.entries(job.layout).map(([id, r]) => ({ id, ...r, walkIds: [id] })) : undefined;
}
