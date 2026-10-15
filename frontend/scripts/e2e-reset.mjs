// "Reset view" on every 3D viewer: after orbiting by hand (and after switching to Top), it snaps the
// camera back to the default fit. Checked on a listing page (full toolbar) and on Fill a room (an
// embed without the toolbar).   (dev server running)  node scripts/e2e-reset.mjs
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};
const errors = [];
const project = (page) => page.evaluate(() => window.__fp3dProject(0, 0, 0)); // a fixed floor point, in page px
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

async function orbit(page, viewer) {
  const box = await viewer.locator("canvas").boundingBox();
  const y = box.y + box.height - 90;
  await page.mouse.move(box.x + 80, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, y - 40, { steps: 10 });
  await page.mouse.up();
  await page.mouse.wheel(0, -400); // and zoom in
  await page.waitForTimeout(900);
}

for (const [label, path] of [["listing page", "/roombae/listings/jvue_3bed"], ["fill a room (no toolbar)", "/roombae/fill-room"]]) {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${APP}${path}`);
  const viewer = page.locator('[data-ready="true"]').first();
  await viewer.waitFor({ timeout: 30000 });
  await viewer.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const home = await project(page);
  await orbit(page, viewer);
  const moved = await project(page);
  check(dist(home, moved) > 25, `${label}: orbit + zoom moved the camera (${Math.round(dist(home, moved))} px)`);
  const reset = viewer.getByRole("button", { name: "Reset view" });
  check(await reset.isVisible(), `${label}: "Reset view" button is visible`);
  await reset.click();
  await page.waitForTimeout(1500);
  const back = await project(page);
  check(dist(home, back) < 4, `${label}: Reset view snaps back to the default fit (${dist(home, back).toFixed(1)} px off)`);
  if (path.includes("listings")) {
    await viewer.getByRole("button", { name: "Top view" }).click();
    await page.waitForTimeout(1200);
    await reset.click();
    await page.waitForTimeout(1500);
    check((await viewer.getAttribute("data-view")) === "3d" && (await viewer.getAttribute("data-angle")) === "corner" && dist(home, await project(page)) < 4,
      `${label}: from Top view, Reset view returns to the starting 3D corner view`);
  }
  await page.close();
}
check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall reset-view checks passed");
process.exit(failures ? 1 : 0);
