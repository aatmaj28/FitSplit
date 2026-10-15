// Phase 1 screenshots (camera presets, cutaway, 2D overlay labels, phone) into /docs/screenshots.
// Needs `npm run dev` (backend optional).   APP_URL=http://localhost:5173 node scripts/screenshots-views.mjs
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "screenshots");
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
const errors = [];

async function open(query, viewport = { width: 1440, height: 1000 }, extra = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, ...extra });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${APP}/${query}`);
  await page.waitForSelector('[data-ready="true"]', { timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-ready="true"]', { timeout: 30000 });
  await page.waitForTimeout(800);
  return page;
}
const shot = async (page, name) => {
  await page.locator("[data-view]").first().screenshot({ path: join(OUT, name) });
  console.log("saved", name);
};

// queen bed + desk + dresser in JVUE bedroom 1, seen from three angles (walls in the way fade out)
{
  const page = await open("?plan=jvue_3bed");
  await page.locator("section[aria-label='Rent split'] [data-room]").first().click();
  await page.getByRole("button", { name: "Edit layout" }).click();
  await page.getByRole("button", { name: "Will my stuff fit?" }).click();
  for (const name of ["Queen bed", "Desk", "Dresser"]) await page.getByRole("button", { name: `More ${name}`, exact: true }).click();
  await page.getByRole("button", { name: /Place 3 along the walls/ }).click();
  for (const [preset, file] of [["Corner", "edit_corner.png"], ["Front", "edit_front.png"], ["Side", "edit_side.png"]]) {
    await page.getByRole("button", { name: `${preset} view` }).click();
    await page.waitForTimeout(1600);
    await shot(page, file);
  }
  await page.getByRole("button", { name: "Rotate view 45° left" }).click();
  await page.waitForTimeout(1400);
  await shot(page, "edit_rotated.png");
  await page.close();
}

// top view with the 2D plan: labels sit next to the printed room names, not on them
{
  const page = await open("?plan=jvue_3bed&view=top");
  await page.getByRole("button", { name: "Show 2D plan" }).click();
  await page.waitForTimeout(1500);
  await shot(page, "top_2d_labels.png");
  await page.close();
}

// phone: edit mode with the sheet folded
{
  const page = await open("?plan=jvue_3bed", { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  await page.locator("section[aria-label='Rent split'] [data-room]").first().tap();
  await page.getByRole("button", { name: "Edit layout" }).tap();
  await page.getByRole("button", { name: "Will my stuff fit?" }).tap();
  for (const name of ["Queen bed", "Desk"]) await page.getByRole("button", { name: `More ${name}`, exact: true }).tap();
  await page.getByRole("button", { name: /Place 2 along the walls/ }).tap();
  await page.getByRole("button", { name: "Fold panel" }).tap();
  await page.waitForTimeout(1400);
  await shot(page, "phone_edit.png");
  await page.close();
}

await browser.close();
if (errors.length) {
  console.error("page errors:", errors);
  process.exit(1);
}
