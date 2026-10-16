/**
 * Media jobs (listing video / photos -> tags, amenities, description, walkthrough, estimated plan).
 * Live: the backend's /api/media/jobs. Offline: jobs bundled under public/demo/media/<id>/.
 */
import { API, DEMO, fetchJson } from "../api";
import { planSource } from "../data/plans";

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

/** Finished jobs to pick from (backend list, or the bundled index offline). */
export async function listMediaJobs(): Promise<{ jobs: MediaSummary[]; offline: boolean }> {
  const { offline } = await planSource();
  if (!offline) {
    try {
      return { jobs: await fetchJson<MediaSummary[]>(`${API}/api/media/jobs`), offline: false };
    } catch {
      /* fall through to the bundle */
    }
  }
  return { jobs: await fetchJson<MediaSummary[]>(`${DEMO}/media/index.json`).catch(() => []), offline: true };
}

/** URL of a job file ("frames/f001.jpg", "plan/plan.svg", ...). */
export function mediaUrl(job: Pick<MediaJob, "id" | "offline">, file: string): string {
  return job.offline ? `${DEMO}/media/${job.id}/${file}` : `${API}/api/media/jobs/${job.id}/files/${file}`;
}

export function frameUrl(job: Pick<MediaJob, "id" | "offline" | "frames">, frameId: number): string | undefined {
  const f = job.frames.find((x) => x.id === frameId);
  return f && mediaUrl(job, f.file);
}
