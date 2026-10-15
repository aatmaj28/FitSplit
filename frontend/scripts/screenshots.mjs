// Screenshots of the dev page for /docs/screenshots (needs `npm run dev` + the backend running).
//   APP_URL=http://localhost:5173 node scripts/screenshots.mjs
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "screenshots");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
const errors = [];

async function open(page, query) {
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${APP}/${query}`);
  await page.waitForSelector('[data-ready="true"]', { timeout: 30000 });
  await page.waitForTimeout(1200); // shadows + labels settle
}

async function shot(locator, name) {
  await locator.screenshot({ path: join(OUT, name) });
  console.log("saved", name);
}

const desktop = { viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 };

for (const plan of ["jvue_3bed", "longwood_2bed"]) {
  const page = await browser.newPage(desktop);
  await open(page, `?plan=${plan}`);
  const viewer = page.locator("[data-view]");
  await shot(viewer, `${plan}_3d.png`);

  await page.getByRole("button", { name: "Show 2D plan" }).click();
  await page.waitForTimeout(800);
  await shot(viewer, `${plan}_3d_with_2d.png`);

  await page.getByRole("button", { name: "Top view" }).click();
  await page.waitForTimeout(1200);
  await shot(viewer, `${plan}_top_2d.png`);
  await page.close();
}

// click a room in the 3D scene itself (raycast, not the label) and show the side panel
{
  const page = await browser.newPage(desktop);
  await open(page, "?plan=jvue_3bed&view=top");
  const box = await page.locator("canvas").boundingBox();
  const label = await page.getByRole("button", { name: /^DREAM · 205/ }).boundingBox();
  await page.mouse.click(label.x + label.width / 2, label.y + label.height / 2 + 40); // floor just below the label
  await page.waitForSelector("aside");
  await page.getByRole("button", { name: "Corner view" }).click();
  await page.waitForTimeout(1200);
  console.log("canvas", Math.round(box.width), "x", Math.round(box.height), "| selected:", await page.locator("aside h2").textContent());
  await shot(page.locator("main"), "jvue_3bed_room_panel.png");
  await page.close();
}

// backend unreachable -> bundled demo data + badge
{
  const page = await browser.newPage(desktop);
  await page.route("**/api/**", (route) => route.abort());
  await open(page, "?plan=longwood_2bed");
  await shot(page.locator("body"), "offline_demo.png");
  await page.close();
}

// phone layout with the room sheet open
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await open(page, "?plan=longwood_2bed");
  await page.getByRole("button", { name: /^Master Bedroom · / }).tap();
  await page.waitForSelector("aside");
  await page.waitForTimeout(600);
  await shot(page.locator("body"), "mobile_longwood_2bed.png");
  await page.close();
}

await browser.close();
if (errors.length) {
  console.error("page errors:", errors);
  process.exit(1);
}
