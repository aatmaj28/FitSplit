// Browser checks for the 3D viewer (needs `npm run dev`; uses the dev-only window.__fp3dProject probe):
// mouse drag from a non-top angle, orbit still works in edit mode, touch drag with one finger,
// two-finger camera gestures, camera re-fit on resize.   node scripts/e2e-viewer.mjs
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};
const errors = [];

async function setup(viewport, extra = {}) {
  const page = await browser.newPage({ viewport, ...extra });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${APP}/?plan=jvue_3bed`);
  await page.waitForSelector('[data-ready="true"]', { timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-ready="true"]', { timeout: 30000 });
  const tap = extra.hasTouch ? "tap" : "click";
  await page.locator("section[aria-label='Rent split'] [data-room]").first()[tap]();
  await page.getByRole("button", { name: "Edit layout" })[tap]();
  await page.getByRole("button", { name: "Will my stuff fit?" })[tap]();
  for (const name of ["Queen bed", "Desk"]) await page.getByRole("button", { name: `More ${name}`, exact: true })[tap]();
  await page.getByRole("button", { name: /Place 2 along the walls/ })[tap]();
  if (extra.hasTouch) await page.getByRole("button", { name: "Fold panel" }).tap();
  await page.waitForTimeout(1500);
  return page;
}
const layout = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("fp3d.layout.v1:jvue_3bed") ?? "[]"));
const project = (page, x, z, y = 0) => page.evaluate(([x, z, y]) => window.__fp3dProject(x, z, y), [x, z, y]);
const near = (a, b, px = 2) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= px;

// --- desktop: drag the bed with the mouse in the Front view; orbit on empty floor still works
{
  const page = await setup({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Front view" }).click();
  await page.waitForTimeout(1500);
  const bed = (await layout(page)).find((i) => i.kind === "queen_bed");
  const ref = await project(page, bed.x, bed.z - 12); // a floor point away from the bed, to see camera motion
  const [sx, sy] = await project(page, bed.x, bed.z, 1);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(sx + i * 12, sy, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const moved = (await layout(page)).find((i) => i.kind === "queen_bed");
  check(moved.x > bed.x + 1, `mouse drag in Front view moves the bed (x ${bed.x.toFixed(2)} -> ${moved.x.toFixed(2)} ft)`);
  check(near(ref, await project(page, bed.x, bed.z - 12)), "camera stays put while dragging a piece");

  // orbit: drag on empty space (bottom-left of the canvas, far from the furniture)
  const box = await page.locator("canvas").boundingBox();
  await page.mouse.move(box.x + 60, box.y + box.height - 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + box.height - 120, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  check(!near(ref, await project(page, bed.x, bed.z - 12), 20), "dragging empty floor in edit mode orbits the camera");
  const after = (await layout(page)).find((i) => i.kind === "queen_bed");
  check(Math.abs(after.x - moved.x) < 1e-6 && Math.abs(after.z - moved.z) < 1e-6, "orbiting does not move furniture");

  // resize: the camera re-fits so the room is back in view
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.waitForTimeout(1500);
  const c = await page.locator("canvas").boundingBox();
  const [px, py] = await project(page, after.x, after.z);
  check(px > c.x && px < c.x + c.width && py > c.y && py < c.y + c.height, `after a resize the bed is on screen (${Math.round(px)}, ${Math.round(py)})`);
  await page.close();
}

// --- phone: one finger moves the selected piece (from anywhere), two fingers move the camera
{
  const page = await setup({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const items = await layout(page);
  const bed = items.find((i) => i.kind === "queen_bed");
  const ref = await project(page, bed.x, bed.z - 12);
  // tap the bed to select it
  const [bx, by] = await project(page, bed.x, bed.z, 1);
  await touch("touchStart", [[bx, by]]);
  await touch("touchEnd", []);
  await page.waitForTimeout(400);
  // one finger on empty floor next to the bed, dragged 60 px
  const [fx, fy] = await project(page, bed.x + 4, bed.z - 2);
  await touch("touchStart", [[fx, fy]]);
  for (let i = 1; i <= 8; i++) await touch("touchMove", [[fx + i * 8, fy]]);
  await touch("touchEnd", []);
  await page.waitForTimeout(400);
  const moved = (await layout(page)).find((i) => i.kind === "queen_bed");
  check(Math.hypot(moved.x - bed.x, moved.z - bed.z) > 0.75, `one-finger drag moves the selected bed (${bed.x.toFixed(2)},${bed.z.toFixed(2)} -> ${moved.x.toFixed(2)},${moved.z.toFixed(2)})`);
  check(near(ref, await project(page, bed.x, bed.z - 12)), "one-finger drag does not move the camera");
  // two fingers: pinch / rotate the camera, furniture stays
  const [cx, cy] = [195, 360];
  await touch("touchStart", [[cx - 40, cy], [cx + 40, cy]]);
  for (let i = 1; i <= 8; i++) await touch("touchMove", [[cx - 40 - i * 6, cy + i * 4], [cx + 40 + i * 6, cy - i * 4]]);
  await touch("touchEnd", []);
  await page.waitForTimeout(800);
  check(!near(ref, await project(page, bed.x, bed.z - 12), 10), "two-finger gesture moves the camera");
  const still = (await layout(page)).find((i) => i.kind === "queen_bed");
  check(Math.abs(still.x - moved.x) < 1e-6 && Math.abs(still.z - moved.z) < 1e-6, "two-finger gesture does not move furniture");
  const scrollY = await page.evaluate(() => window.scrollY);
  check(scrollY === 0, `page did not scroll during touch gestures (scrollY ${scrollY})`);
  await page.close();
}

await browser.close();
if (errors.length) console.error("page errors:", errors);
console.log(failures || errors.length ? `\n${failures} check(s) failed, ${errors.length} page error(s)` : "\nall viewer checks passed");
process.exit(failures || errors.length ? 1 : 0);
