// Bundle finished media jobs for offline use: data/media_jobs/<id>/ (job.json, frames, panoramas,
// estimated plan, walkthrough) -> public/demo/media/<id>/, plus public/demo/media/index.json (the
// same shape as GET /api/media/jobs). Job folders themselves stay out of git.
//   node scripts/bundle-media.mjs [job ids...]     (default: the demo video's job)
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JOBS = join(ROOT, "data", "media_jobs");
const OUT = join(ROOT, "frontend", "public", "demo", "media");
const DEMO_JOBS = ["mj_e0087b208573"]; // data/media/VIDEO-2026-10-07-18-17-39.mp4

/** The card photo: the first living room frame, else kitchen, else the first frame (same as the API). */
function cover(job) {
  for (const type of ["living", "kitchen"]) {
    const t = job.tags.find((x) => x.room_type === type);
    const f = t && job.frames.find((x) => x.id === t.frame);
    if (f) return f.file;
  }
  return job.frames[0]?.file ?? null;
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : DEMO_JOBS;
mkdirSync(OUT, { recursive: true });
const indexPath = join(OUT, "index.json");
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : [];
let bytes = 0;
for (const id of ids) {
  const src = join(JOBS, id);
  const job = JSON.parse(readFileSync(join(src, "job.json"), "utf8"));
  if (job.status !== "complete") throw new Error(`${id} is ${job.status}, not complete`);
  const dst = join(OUT, id);
  rmSync(dst, { recursive: true, force: true });
  for (const dir of ["frames", "pano", "plan", "walk"]) {
    if (!existsSync(join(src, dir))) continue;
    mkdirSync(join(dst, dir), { recursive: true });
    for (const f of readdirSync(join(src, dir))) {
      if (!/\.(jpg|png|svg|json)$/.test(f)) continue;
      copyFileSync(join(src, dir, f), join(dst, dir, f));
      bytes += statSync(join(dst, dir, f)).size;
    }
  }
  // the bundle doesn't need the uploads' hashes or the agent's listing text
  const { existing_amenities: _e, ...rest } = job;
  const slim = { ...rest, inputs: job.inputs.map(({ sha256: _s, ...i }) => i) };
  writeFileSync(join(dst, "job.json"), JSON.stringify(slim));
  bytes += statSync(join(dst, "job.json")).size;
  const names = job.inputs.map((i) => i.name);
  const entry = {
    id, title: names.length === 1 ? names[0] : `${names.length} photos`, inputs: names.slice(0, 3).join(", "),
    frames: job.frames.length, cover: cover(job), created: job.created,
  };
  const at = index.findIndex((e) => e.id === id);
  if (at >= 0) index[at] = entry;
  else index.push(entry);
  console.log(`${id}: ${job.frames.length} frames, ${job.walkthrough?.rooms.length ?? 0} rooms, plan ${job.plan ? "yes" : "no"}`);
}
writeFileSync(indexPath, JSON.stringify(index, null, 1));
console.log(`bundled ${ids.length} job(s), ${(bytes / 1024 / 1024).toFixed(1)} MB -> ${OUT}`);
