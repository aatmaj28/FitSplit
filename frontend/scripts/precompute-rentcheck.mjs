// Run the AI rent check (backend + its vision providers) for the demo inputs and bundle the results
// in public/demo/rentcheck/ so the "AI checked" badge works offline. Results the backend already has
// cached cost nothing. Needs the backend running.
//   node scripts/precompute-rentcheck.mjs [plan ...]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "demo", "rentcheck");
const API = process.env.API_URL ?? "http://localhost:8000";
// full set (method / closets / each bedroom's private-bath flag flipped) for the two main demo units,
// the default split for the other listings
const FULL = ["jvue_3bed", "longwood_2bed"];
const DEFAULT_ONLY = ["jvue_1bed", "longwood_1bed", "missionmain_3bed", "serenity_1bed"];
const names = process.argv.slice(2).length ? process.argv.slice(2) : [...FULL, ...DEFAULT_ONLY];

const server = await createServer({ root: ROOT, logLevel: "error", appType: "custom", server: { middlewareMode: true, hmr: false, ws: false } });
const { computeSplit, bedrooms } = await server.ssrLoadModule("/src/rentSplit.ts");
const RC = await server.ssrLoadModule("/src/rentCheck.ts");

mkdirSync(OUT, { recursive: true });
let index = {};
try {
  index = JSON.parse(readFileSync(join(OUT, "index.json"), "utf8")).checks;
} catch {
  /* first run */
}

async function runCheck(name, plan, v) {
  const split = computeSplit(plan, { method: v.method, includeClosets: v.includeClosets, rent: plan.unit.rent, bathOverride: v.bathOverride });
  const req = RC.rentCheckRequest(name, split, v);
  const key = RC.rentCheckKey(req);
  const res = await fetch(`${API}/api/rent-check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
  const body = await res.json();
  if (!res.ok) {
    console.log(`  ${v.label}: FAILED ${res.status} ${JSON.stringify(body.detail ?? body).slice(0, 300)}`);
    return null;
  }
  writeFileSync(join(OUT, `${key}.json`), JSON.stringify(body, null, 2));
  index[key] = `${key}.json`;
  const warn = body.checks.filter((c) => c.status === "warn").map((c) => c.id);
  console.log(`  ${v.label}: ${body.verdict}${warn.length ? ` (${warn.join(", ")})` : ""}${body.suggestions.length ? `, suggests: ${body.suggestions.map((s) => s.label).join("; ")}` : ""} [${body.provider}${body.cached ? ", cached" : ""}]`);
  return body;
}

for (const name of names) {
  const plan = JSON.parse(readFileSync(join(ROOT, "public", "demo", `${name}.json`), "utf8"));
  console.log(`${name}:`);
  const variants = [{ label: "fair split", method: "fair", includeClosets: false, bathOverride: {} }];
  if (FULL.includes(name)) {
    variants.push({ label: "by size", method: "size", includeClosets: false, bathOverride: {} });
    variants.push({ label: "fair + closets", method: "fair", includeClosets: true, bathOverride: {} });
    for (const r of bedrooms(plan)) {
      variants.push({ label: `private bath ${r.has_private_bath ? "off" : "on"} for ${r.id}`, method: "fair", includeClosets: false, bathOverride: { [r.id]: !r.has_private_bath } });
    }
  }
  const done = new Set();
  const queue = [...variants];
  while (queue.length) {
    const v = queue.shift();
    const id = JSON.stringify([v.method, v.includeClosets, v.bathOverride]);
    if (done.has(id)) continue;
    done.add(id);
    const result = await runCheck(name, plan, v);
    // one level of "Apply suggestion", so following a suggestion offline still shows a check
    if (result && !v.applied) {
      for (const s of result.suggestions) {
        const next = { ...v, label: `${v.label} -> ${s.label}`, applied: true, bathOverride: { ...v.bathOverride } };
        if (s.action === "set_private_bath") next.bathOverride[s.room_id] = s.value;
        if (s.action === "include_closets") next.includeClosets = s.value;
        queue.push(next);
      }
    }
  }
}

writeFileSync(join(OUT, "index.json"), JSON.stringify({ checks: index }, null, 2));
const usage = await (await fetch(`${API}/api/llm/usage`)).json();
console.log(`\n${Object.keys(index).length} checks bundled. API calls so far:`, JSON.stringify(Object.fromEntries(Object.entries(usage.providers).map(([k, v]) => [k, v.calls]))), `Claude left: ${usage.claude_remaining}`);
await server.close();
