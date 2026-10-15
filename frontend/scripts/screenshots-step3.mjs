// Step 3 screenshots (furniture fit + rent split) into /docs/screenshots.
// Needs `npm run dev` and the backend running.   APP_URL=http://localhost:5173 node scripts/screenshots-step3.mjs
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "screenshots");
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
const errors = [];

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${APP}/${query}`);
  await page.waitForSelector('[data-ready="true"]', { timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-ready="true"]', { timeout: 30000 });
  await page.waitForTimeout(800);
  return page;
}
const cards = (page) => page.locator("section[aria-label='Rent split'] [data-room]");
const statusLines = async (page) => (await page.locator("aside li button").allInnerTexts()).map((t) => t.split("\n")[0]);

// --- furniture: queen bed + desk + dresser in JVUE bedroom 1 (green), then the bed shoved into a wall (red)
{
  const page = await open("?plan=jvue_3bed&view=top");
  await cards(page).first().click();
  await page.getByRole("button", { name: "Edit layout" }).click();
  await page.getByRole("button", { name: "Will my stuff fit?" }).click();
  for (const name of ["Queen bed", "Desk", "Dresser"]) await page.getByRole("button", { name: `More ${name}`, exact: true }).click();
  await page.getByRole("button", { name: /Place 3 along the walls/ }).click();
  await page.waitForTimeout(1800); // edit mode frames the selected bedroom
  console.log("green:", await statusLines(page));
  await page.locator("[data-view]").screenshot({ path: join(OUT, "furniture_green.png") });
  console.log("saved furniture_green.png");
  await page.getByRole("button", { name: "Corner view" }).click(); // same layout as 3D boxes
  await page.waitForTimeout(1500);
  await page.locator("[data-view]").screenshot({ path: join(OUT, "furniture_3d.png") });
  console.log("saved furniture_3d.png");
  await page.getByRole("button", { name: "Top view" }).click();
  await page.waitForTimeout(1500);

  // shove the bed past the nearest wall of its room with Shift+arrows (1 ft steps)
  const plan = await (await page.request.get(`${APP}/api/plans/jvue_3bed`)).json();
  const items = await page.evaluate(() => JSON.parse(localStorage.getItem("fp3d.layout.v1:jvue_3bed") ?? "[]"));
  const bed = items.find((i) => i.kind === "queen_bed");
  const ppf = plan.scale.pixels_per_foot;
  const poly = plan.rooms.find((r) => r.id === bed.roomId).polygon.map(([x, y]) => [x / ppf, y / ppf]);
  const [minX, maxX] = [Math.min(...poly.map((p) => p[0])), Math.max(...poly.map((p) => p[0]))];
  const sx = (bed.rot % 180 ? bed.d : bed.w) / 24; // half extent in ft
  const gapLeft = bed.x - sx - minX, gapRight = maxX - (bed.x + sx);
  const [key, gap] = gapLeft <= gapRight ? ["Shift+ArrowLeft", gapLeft] : ["Shift+ArrowRight", gapRight];
  await page.locator("aside li button", { hasText: "Queen bed" }).click();
  for (let i = 0; i < Math.ceil(gap) + 1; i++) await page.keyboard.press(key);
  await page.waitForTimeout(600);
  console.log("red:", await statusLines(page));
  await page.locator("[data-view]").screenshot({ path: join(OUT, "furniture_red.png") });
  console.log("saved furniture_red.png");
  await page.close();
}

// --- rent split panels (fair split, a bedroom selected = highlighted in 3D too)
for (const [plan, card] of [["jvue_3bed", 2], ["longwood_2bed", 0]]) {
  const page = await open(`?plan=${plan}`);
  await cards(page).nth(card).click();
  await page.waitForTimeout(1200);
  const texts = (await cards(page).allInnerTexts()).map((t) => t.split("\n").filter(Boolean).slice(0, 5).join(" | "));
  console.log(plan, texts, "|", await page.getByText(/Total \$/).innerText());
  await page.locator("main").screenshot({ path: join(OUT, `rent_split_${plan}.png`) });
  console.log(`saved rent_split_${plan}.png`);
  await page.close();
}

await browser.close();
if (errors.length) {
  console.error("page errors:", errors);
  process.exit(1);
}
