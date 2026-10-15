// Copy parsed plans + original images into public/demo/ for the offline fallback.
//   node scripts/sync-demo.mjs [plan ...]      (default: the six listed units)
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parsed = join(root, "..", "data", "parsed");
const out = join(root, "public", "demo");
const DEFAULT = ["jvue_3bed", "longwood_2bed", "jvue_1bed", "longwood_1bed", "missionmain_3bed", "serenity_1bed"];
const names = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;

mkdirSync(out, { recursive: true });
const index = [];
for (const name of names) {
  const plan = JSON.parse(readFileSync(join(parsed, `${name}.json`), "utf8"));
  const original = readdirSync(join(parsed, name)).find((f) => f.startsWith("original."));
  if (!original) throw new Error(`no original image for ${name} (re-run parse_all.py)`);
  writeFileSync(join(out, `${name}.json`), JSON.stringify(plan));
  copyFileSync(join(parsed, name, original), join(out, `${name}.png`));
  index.push({
    name,
    source_image: plan.source_image,
    unit: plan.unit,
    rooms: plan.rooms.length,
    semantics_provider: plan.semantics_provider,
    json: `${name}.json`,
    image: `${name}.png`,
  });
  console.log(`demo: ${name} (${plan.rooms.length} rooms, ${original})`);
}
writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 2));
if (!existsSync(join(out, "index.json"))) process.exit(1);
