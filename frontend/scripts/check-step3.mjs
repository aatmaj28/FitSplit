// Offline checks for Step 3 (no browser, no backend): rent split math and the furniture fit check,
// run with the real TS modules (loaded through Vite) on the bundled demo plans in public/demo/.
//   node scripts/check-step3.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: ROOT, logLevel: "error", appType: "custom", server: { middlewareMode: true, hmr: false, ws: false } });
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

await server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
