// Offline checks for Step 3 (no browser, no backend): rent split math and the furniture fit check,
// run with the real TS modules (loaded through Vite) on the bundled demo plans in public/demo/.
//   node scripts/check-step3.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  root: ROOT, logLevel: "error", appType: "custom", server: { middlewareMode: true, hmr: false, ws: false },
  cacheDir: "node_modules/.vite-scripts", // never touch the running dev server's optimized deps
});
const { computeSplit, bedrooms } = await server.ssrLoadModule("/src/rentSplit.ts");
const { buildModel } = await server.ssrLoadModule("/src/components/FloorPlan3D/geometry.ts");
const F = await server.ssrLoadModule("/src/components/FloorPlan3D/furniture.ts");

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};
const plan = (name) => JSON.parse(readFileSync(join(ROOT, "public", "demo", `${name}.json`), "utf8"));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// --- rent split: whole dollars that add up to the rent, for every method / closet setting
for (const name of ["jvue_3bed", "longwood_2bed"]) {
  const p = plan(name);
  for (const rent of [p.unit.rent, p.unit.rent + 1, 1001])
    for (const method of ["fair", "size"])
      for (const includeClosets of [false, true]) {
        const s = computeSplit(p, { method, includeClosets, rent });
        const total = sum(s.rows.map((r) => r.share));
        const label = `${name} $${rent} ${method}${includeClosets ? " +closets" : ""}`;
        if (rent === p.unit.rent) console.log(`      ${label}: ${s.rows.map((r) => `${r.room.name} $${r.share} (${r.vsEven >= 0 ? "+" : ""}${r.vsEven})`).join(", ")}`);
        check(total === rent && s.rows.every((r) => Number.isInteger(r.share)), `${label}: whole dollars, total $${total} = rent`);
      }
}
{
  const jv = computeSplit(plan("jvue_3bed"), { method: "fair", includeClosets: false, rent: 4200 });
  const shares = jv.rows.map((r) => r.share).sort((a, b) => a - b);
  check([1350, 1360, 1490].every((v, i) => Math.abs(shares[i] - v) <= 15), `jvue_3bed fair ≈ $1,350 / $1,360 / $1,490: got ${shares.join(" / ")}`);
  const top = jv.rows.reduce((a, b) => (b.share > a.share ? b : a));
  check(top.room.has_private_bath && top.privateBath, `jvue_3bed: the private-bath room pays most (${top.room.id}, bath ${top.privateBath?.id})`);
  const lw = plan("longwood_2bed");
  for (const method of ["fair", "size"]) {
    const s = computeSplit(lw, { method, includeClosets: false, rent: lw.unit.rent });
    const top = s.rows.reduce((a, b) => (b.share > a.share ? b : a));
    check(/master/i.test(top.room.name), `longwood_2bed ${method}: ${top.room.name} pays more ($${top.share})`);
  }
}

// --- AI rent check: the browser builds the same cache key as backend/app/rentcheck.py (tests/test_rentcheck.py)
{
  const RC = await server.ssrLoadModule("/src/rentCheck.ts");
  const req = {
    plan: "jvue_3bed", method: "fair", include_closets: false, rent: 4200,
    rows: [
      { room_id: "r4", name: "DREAM", bedroom_area: 193.06, private_bath: false, private_bath_area: 0, share: 1352, vs_even: -48 },
      { room_id: "r5", name: "DREAM", bedroom_area: 196.08, private_bath: false, private_bath_area: 0, share: 1360, vs_even: -40 },
      { room_id: "r6", name: "DREAM", bedroom_area: 205.0, private_bath: true, private_bath_area: 36.9, share: 1488, vs_even: 88 },
    ],
  };
  check(RC.rentCheckKeyString(req) === "rc1|jvue_3bed|fair|0|4200|r4:1931:0:0:1352;r5:1961:0:0:1360;r6:2050:1:369:1488", "rent check key string matches the backend");
  check(RC.rentCheckKey(req) === "8643cdf0dc9a881d", `rent check key hash matches the backend (${RC.rentCheckKey(req)})`);

  // private-bath overrides (what "Apply suggestion" changes): shares move, totals stay exact
  const p = plan("jvue_3bed");
  const base = computeSplit(p, { method: "fair", includeClosets: false, rent: 4200 });
  const off = computeSplit(p, { method: "fair", includeClosets: false, rent: 4200, bathOverride: { r6: false } });
  const suite = (s) => s.rows.find((r) => r.room.id === "r6");
  check(suite(base).hasPrivateBath && !suite(off).hasPrivateBath && suite(off).share < suite(base).share && sum(off.rows.map((r) => r.share)) === 4200,
    `override: private bath off for r6 -> $${suite(base).share} becomes $${suite(off).share}, total still $4,200`);
  const k1 = RC.rentCheckKey(RC.rentCheckRequest("jvue_3bed", base, { method: "fair", includeClosets: false }));
  const k2 = RC.rentCheckKey(RC.rentCheckRequest("jvue_3bed", off, { method: "fair", includeClosets: false }));
  check(k1 !== k2, "different inputs give different rent check keys");
}

// --- furniture: queen bed + desk + dresser in a JVUE bedroom fit; shoved into a wall they don't
{
  const p = plan("jvue_3bed");
  const checker = new F.FitChecker(buildModel(p));
  const room = bedrooms(p)[0];
  const geo = checker.rooms.get(room.id);
  const kinds = ["queen_bed", "desk", "dresser"].map((k) => F.LIBRARY.find((x) => x.kind === k));
  const { placed, failed } = F.autoPlace(kinds, room.id, [], checker);
  check(placed.length === 3 && failed.length === 0, `auto-place queen bed + desk + dresser in ${room.name} (${room.id}): ${placed.length} placed`);
  for (const it of placed) {
    const fit = checker.check(it, placed);
    check(fit.ok, `  ${F.describe(it, fit, room.name)} at (${it.x.toFixed(2)}, ${it.z.toFixed(2)}) ft, ${it.rot}°`);
  }
  const used = sum(placed.map((i) => i.w * i.d * F.IN * F.IN));
  const free = checker.freeArea(room.id, placed);
  check(Math.abs(free - (geo.area - used)) < 0.5, `free floor ${free.toFixed(1)} = ${geo.area} − ${used.toFixed(1)} sq ft`);

  // hand-placed in the middle of the room (snapped to the room's 3" grid) also fits
  const bed = placed.find((i) => i.kind === "queen_bed");
  const [lx, lz] = buildModel(p).rooms.find((r) => r.room.id === room.id).labelAt;
  const [sx, sz] = F.snapCenter(bed, lx, lz, checker.roomOrigin(room.id));
  const centered = { ...bed, x: sx, z: sz };
  const corner = [sx - F.extent(bed).sx / 2 - checker.roomOrigin(room.id)[0], sz - F.extent(bed).sz / 2 - checker.roomOrigin(room.id)[1]];
  check(corner.every((v) => Math.abs(v / F.GRID_FT - Math.round(v / F.GRID_FT)) < 1e-6), `snap: bed corner on the 3" grid (${corner.map((v) => v.toFixed(2)).join(", ")} ft from the room corner)`);
  check(checker.check(centered, [centered]).ok, `queen bed alone at the room center fits`);

  // push the bed 1 ft past its nearest wall
  const { minX, maxX, minZ, maxZ } = geo.box;
  const e = F.extent(bed);
  const gaps = [
    [bed.x - e.sx / 2 - minX, -1, 0],
    [maxX - (bed.x + e.sx / 2), 1, 0],
    [bed.z - e.sz / 2 - minZ, 0, -1],
    [maxZ - (bed.z + e.sz / 2), 0, 1],
  ].sort((a, b) => a[0] - b[0]);
  const [gap, dx, dz] = gaps[0];
  const shoved = { ...bed, x: bed.x + dx * (gap + 1), z: bed.z + dz * (gap + 1) };
  const items = placed.map((i) => (i.id === bed.id ? shoved : i));
  const fit = checker.check(shoved, items);
  check(!fit.ok && fit.issues.some((i) => i.kind === "wall"), `bed pushed 1 ft into the wall: ${F.describe(shoved, fit, room.name)}`);

  // two pieces on top of each other: both red
  const desk = placed.find((i) => i.kind === "desk");
  const stacked = placed.map((i) => (i.id === desk.id ? { ...desk, x: bed.x, z: bed.z } : i));
  const a = checker.check(stacked.find((i) => i.id === bed.id), stacked);
  const b = checker.check(stacked.find((i) => i.id === desk.id), stacked);
  check(!a.ok && !b.ok && a.issues.some((i) => i.kind === "item") && b.issues.some((i) => i.kind === "item"), `desk dropped on the bed: "${F.describe(bed, a, room.name)}"`);

  // doorways (from geometry: outline stretches with no wall, windows dropped): every bedroom has one,
  // auto-place keeps them clear, a piece parked in one still fits but gets a note
  for (const name of ["jvue_3bed", "longwood_2bed"]) {
    const q = plan(name);
    const c = new F.FitChecker(buildModel(q));
    for (const r of bedrooms(q)) {
      const ds = c.doorways(r.id);
      check(ds.length >= 1, `${name} ${r.name} (${r.id}): ${ds.length} doorway(s), ${ds.map((d) => `${d.width.toFixed(1)} ft`).join(", ")}`);
    }
  }
  check(placed.every((i) => checker.check(i, placed).blocks.length === 0), `auto-placed pieces keep ${room.name}'s doorways clear`);
  const door = checker.doorways(room.id)[0];
  const [zx, zz] = [sum(door.zone.map((p) => p[0])) / 4, sum(door.zone.map((p) => p[1])) / 4];
  const nightstand = { ...bed, id: "ns", kind: "nightstand", name: "Nightstand", w: 20, d: 16, h: 24, rot: 0, x: zx, z: zz };
  const parked = checker.check(nightstand, [nightstand]);
  check(parked.ok && parked.blocks.length === 1, `nightstand in front of the door: ${F.describe(nightstand, parked, room.name)}`);

  // a king bed rotated against the closets / in a tiny room doesn't fit
  const closet = p.rooms.filter((r) => r.type === "closet").map((r) => checker.rooms.get(r.id)).sort((x, y) => x.area - y.area)[0];
  const king = { ...bed, id: "king", kind: "king_bed", name: "King bed", w: 76, d: 80, x: (closet.box.minX + closet.box.maxX) / 2, z: (closet.box.minZ + closet.box.maxZ) / 2, roomId: closet.id };
  check(!checker.check(king, [king]).ok, `king bed in ${closet.name} (${closet.area} sq ft): ${F.describe(king, checker.check(king, [king]), closet.name)}`);
}

// --- Discover deck: Tanvi's filters (location, both-ways gender preference, seen), sorted by location then name
{
  const D = await server.ssrLoadModule("/src/roommates/deck.ts");
  const profiles = JSON.parse(readFileSync(join(ROOT, "public", "demo", "roommates", "profiles.json"), "utf8"));
  const by = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const city = (p, c) => ({ ...p, questionnaire: { ...p.questionnaire, living: { ...p.questionnaire.living, city: c } } });
  const { deck, hidden } = D.discoverDeck(by.priya, profiles, []);
  check(deck.map((p) => p.id).join(",") === "ananya,jake,kavya,meera,rohan", `deck for Priya: ${deck.map((p) => p.id).join(", ")}`);
  const why = Object.fromEntries(hidden.map((h) => [h.p.id, h.reason]));
  check(why.daniel === "location" && why.marcus === "gender" && why.arjun === "hosting" && why.sofia === "hosting", `hidden: ${JSON.stringify(why)}`);
  check(D.locationScore(by.priya, city(by.ananya, "Cambridge")) === 2 && D.locationScore(by.priya, city(by.ananya, "Manhattan")) === 0 && D.locationScore(by.priya, by.ananya) === 3,
    "location score: same city 3, same metro 2, elsewhere 0");
  const cambridge = D.discoverDeck(by.priya, [by.priya, city(by.ananya, "Cambridge"), city(by.meera, "Boston")], []).deck.map((p) => p.id);
  check(cambridge.join(",") === "meera,ananya", "same city sorts before same metro");
  check(!D.genderMatch(by.priya, by.marcus) && !D.genderMatch(by.marcus, by.priya) && D.genderMatch(by.marcus, by.rohan), "same-gender-only is checked both ways");
  const seen = D.discoverDeck(by.priya, profiles, [{ id: "ananya", dir: "like", at: "" }, { id: "kavya", dir: "pass", at: "" }]).deck.map((p) => p.id);
  check(seen.join(",") === "jake,meera,rohan", "swiped profiles (liked or passed) are hidden");
  const noCity = D.discoverDeck(city(by.priya, ""), profiles, []).deck.map((p) => p.id);
  check(noCity.includes("daniel"), "without a city of your own nobody is hidden for location (as in Tanvi's)");
  check(/^Jake smokes, and you need a non-smoking home\.$/.test(D.noClickReason(by.priya, by.jake, { result: { status: "incompatible", reason: "smoking", unresolved_topics: [], source: "vrd" } })), "didn't-click line for Jake names the smoking");
  check(/budgets don't overlap/.test(D.noClickReason(by.daniel, by.kavya, { result: { status: "incompatible", reason: "", unresolved_topics: [], source: "vrd" } })), "didn't-click line for budgets that don't overlap");
}

await server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
