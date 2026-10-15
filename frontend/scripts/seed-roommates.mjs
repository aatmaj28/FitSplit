// Pre-generate the demo roommate negotiations (backend + free text models first) and bundle them in
// public/demo/roommates/ for offline replay. Stored negotiations are reused, so re-running only fills gaps.
// The "Fill a room" context (exact rent share, private bath, whether the candidate's furniture fits) is
// computed here with the same code the app uses (rentSplit.ts, furniture.ts).
//   (backend running)  node scripts/seed-roommates.mjs [--export-only]
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "..", "data", "roommates");
const OUT = join(ROOT, "public", "demo", "roommates");
const API = process.env.API_URL ?? "http://localhost:8000";
const exportOnly = process.argv.includes("--export-only");

// people first, in priority order for a tight model quota: the guided demo's pairs (Priya swipes
// right on Ananya, Jake and Meera; Ananya + Meera completes the group), then the rest of Priya's
// Discover deck (every card she can swipe right on has a bundled conversation)
const FIND = [["priya", "ananya"], ["priya", "jake"], ["priya", "meera"], ["ananya", "meera"], ["priya", "kavya"], ["priya", "rohan"]];
// apartment first: Arjun (Bedroom 1) and Sofia (Bedroom 3) have the JVUE 3 bed and need someone for Bedroom 2
const FILL = { plan: "jvue_3bed", unit: "JVUE 3 bed", open: "r5", members: [["arjun", "r4"], ["sofia", "r6"]], candidates: ["rohan", "jake", "kavya"] };

const server = await createServer({
  root: ROOT, logLevel: "error", appType: "custom", server: { middlewareMode: true, hmr: false, ws: false },
  cacheDir: "node_modules/.vite-scripts", // never touch the running dev server's optimized deps
});
const { computeSplit } = await server.ssrLoadModule("/src/rentSplit.ts");
const { buildModel } = await server.ssrLoadModule("/src/components/FloorPlan3D/geometry.ts");
const F = await server.ssrLoadModule("/src/components/FloorPlan3D/furniture.ts");

async function api(path, body) {
  const res = await fetch(`${API}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

// the previous bundle: a pair whose new conversation can't be generated (quota) keeps its old one
const previous = existsSync(join(OUT, "scenarios.json")) ? JSON.parse(readFileSync(join(OUT, "scenarios.json"), "utf8")) : null;
const kept = []; // [label, id] of conversations kept from the previous bundle

async function finishOrKeep(rec, label, oldId) {
  try {
    return await finish(rec, label);
  } catch (e) {
    if (!oldId || !existsSync(join(DATA, "negotiations", `${oldId}.json`))) throw e;
    console.log(`\r  ${label}: could not regenerate (${String(e.message).slice(0, 120)}); keeping the previous conversation ${oldId}`);
    kept.push([label, oldId]);
    return api(`/api/roommates/negotiations/${oldId}`);
  }
}

async function finish(rec, label) {
  let last = -1;
  while (rec.status === "running") {
    await new Promise((r) => setTimeout(r, 4000));
    rec = await api(`/api/roommates/negotiations/${rec.id}`);
    if (rec.messages.length !== last) {
      last = rec.messages.length;
      process.stdout.write(`\r  ${label}: ${last} messages...   `);
    }
  }
  if (rec.status === "error") throw new Error(`${label}: ${rec.error}`);
  const r = rec.result;
  console.log(`\r  ${label}: ${r.status} (${r.source}${r.reason ? `: ${r.reason}` : ""}) ${rec.messages.length} turns, overall ${rec.analysis?.scores?.overall ?? "-"} [${Object.entries(rec.providers ?? {}).map(([k, v]) => `${k}:${v}`).join(" ")}]`);
  return rec;
}

const profiles = await api("/api/roommates/profiles");
const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
const scenarios = { find: { pairs: [], groups: [] }, fill: [] };

console.log("Find roommates:");
for (const [a, b] of FIND) {
  const oldId = previous?.find.pairs.find((p) => p.a === a && p.b === b)?.id;
  let rec = await api("/api/roommates/negotiations", { a, b });
  if (!exportOnly || rec.status === "complete") rec = await finishOrKeep(rec, `${byId[a].name} + ${byId[b].name}`, oldId);
  scenarios.find.pairs.push({ a, b, id: rec.id, status: rec.result?.status ?? null });
}
scenarios.find.groups = await api("/api/roommates/groups", { profile_ids: [...new Set(FIND.flat())], size: 3 });

console.log("Fill a room:");
const plan = JSON.parse(readFileSync(join(ROOT, "public", "demo", `${FILL.plan}.json`), "utf8"));
const split = computeSplit(plan, { method: "fair", includeClosets: false, rent: plan.unit.rent });
const label = (id) => {
  const i = split.rows.findIndex((r) => r.room.id === id);
  return `Bedroom ${i + 1} (${split.rows[i].room.name})`;
};
const row = (id) => split.rows.find((r) => r.room.id === id);
const checker = new F.FitChecker(buildModel(plan));
const kind = (f) => (typeof f === "string" ? F.LIBRARY.find((k) => k.kind === f) : { kind: "custom", color: F.CUSTOM_COLOR, ...f });
for (const candidate of FILL.candidates) {
  const kinds = byId[candidate].furniture.map(kind);
  const { placed, failed, blocking } = F.autoPlace(kinds, FILL.open, [], checker);
  const furniture = {
    items: kinds.map((k) => k.name),
    all_fit: failed.length === 0,
    free_sqft: Math.round(checker.freeArea(FILL.open, placed) * 10) / 10,
    note: failed.length ? `no room left for ${failed.map((f) => f.name).join(", ")}` : blocking.length ? `${blocking.map((b) => b.name).join(", ")} had to go in front of a doorway` : "",
  };
  const room = {
    plan: FILL.plan, unit_name: FILL.unit, rent_total: plan.unit.rent, beds: plan.unit.beds, room_id: FILL.open, room_label: label(FILL.open),
    area_sqft: Math.round(row(FILL.open).bedroomArea * 10) / 10, share: row(FILL.open).share, private_bath: row(FILL.open).hasPrivateBath, furniture,
    members: FILL.members.map(([id, rid]) => ({ profile_id: id, name: byId[id].name, room_label: label(rid), share: row(rid).share })),
  };
  const out = await api("/api/roommates/fill-room", { candidate, members: FILL.members.map(([id]) => id), room, rule: "all" });
  const recs = [];
  for (const n of out.negotiations) {
    const oldId = previous?.fill.find((f) => f.candidate === candidate)?.negotiations.find((x) => x.member.id === n.member.id)?.id;
    const rec = await api(`/api/roommates/negotiations/${n.id}`);
    recs.push(exportOnly && rec.status !== "complete" ? rec : await finishOrKeep(rec, `${byId[candidate].name} + ${n.member.name}`, oldId));
  }
  const status = await api("/api/roommates/fill-room/status", { ids: recs.map((r) => r.id), rule: "all" });
  scenarios.fill.push({ id: `fill_${candidate}`, candidate, members: FILL.members.map(([id, rid]) => ({ id, room_id: rid })), room, ...status, layout: placed });
  console.log(`  => ${byId[candidate].name}: ${status.group ? status.group.summary : "not finished"}`);
}

// drop stored negotiations of these same pairs from older profile / engine versions (they would
// otherwise still count in POST /groups)
const current = new Set([...scenarios.find.pairs.map((p) => p.id), ...scenarios.fill.flatMap((f) => f.negotiations.map((n) => n.id))]);
const seeded = new Set([...FIND.map(([a, b]) => `find:${a}:${b}`), ...FILL.candidates.flatMap((c) => FILL.members.map(([m]) => `fill:${c}:${m}`))]);
for (const f of existsSync(join(DATA, "negotiations")) ? readdirSync(join(DATA, "negotiations")) : []) {
  const rec = JSON.parse(readFileSync(join(DATA, "negotiations", f), "utf8"));
  if (!current.has(rec.id) && seeded.has(`${rec.mode}:${rec.a.id}:${rec.b.id}`)) {
    rmSync(join(DATA, "negotiations", f));
    console.log(`  removed stale ${rec.mode} negotiation ${rec.a.name} + ${rec.b.name} (${rec.id})`);
  }
}
if (seeded.size) scenarios.find.groups = await api("/api/roommates/groups", { profile_ids: [...new Set(FIND.flat())], size: 3 });

// every bundled conversation gets plain-English lines (rm2 clones write their own SAY lines; a
// conversation kept from engine rm1 gets them from one cached narration call)
for (const id of [...scenarios.find.pairs.map((p) => p.id), ...scenarios.fill.flatMap((f) => f.negotiations.map((n) => n.id))]) {
  const rec = await api(`/api/roommates/negotiations/${id}`);
  if (rec.status !== "complete" || !rec.messages.length || rec.messages.every((m) => m.say)) continue;
  try {
    const out = await api(`/api/roommates/negotiations/${id}/narrate`, {});
    console.log(`  narrated ${rec.a.name} + ${rec.b.name}: ${out.messages.filter((m) => m.say).length}/${out.messages.length} lines`);
  } catch (e) {
    console.log(`  narration of ${rec.a.name} + ${rec.b.name} failed: ${String(e.message).slice(0, 120)}`);
  }
}

// bundle for offline replay
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "negotiations"), { recursive: true });
const ids = [...scenarios.find.pairs.map((p) => p.id), ...scenarios.fill.flatMap((f) => f.negotiations.map((n) => n.id))];
for (const id of ids) {
  const src = join(DATA, "negotiations", `${id}.json`);
  if (existsSync(src)) cpSync(src, join(OUT, "negotiations", `${id}.json`));
}
writeFileSync(join(OUT, "profiles.json"), JSON.stringify(profiles, null, 2));
writeFileSync(join(OUT, "questionnaire.json"), JSON.stringify(await api("/api/roommates/questionnaire"), null, 2));
writeFileSync(join(OUT, "scenarios.json"), JSON.stringify(scenarios, null, 2));
const usage = await api("/api/llm/usage");
if (kept.length) console.log(`\nkept from the previous bundle (not regenerated): ${kept.map(([l, id]) => `${l} (${id})`).join(", ")}`);
console.log(`\nbundled ${ids.length} negotiations in public/demo/roommates. API calls so far:`,
  JSON.stringify(Object.fromEntries(Object.entries(usage.providers).map(([k, v]) => [k, v.calls]))), `Claude left: ${usage.claude_remaining}`);
await server.close();
