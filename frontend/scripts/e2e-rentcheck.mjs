// Browser checks for the "AI checked" rent split (needs `npm run dev`; uses the bundled demo results,
// so no model is called): badge, details, Apply suggestion, a wrong private-bath input, offline mode.
//   node scripts/e2e-rentcheck.mjs        (also writes docs/screenshots/rent_check_*.png)
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "screenshots");
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};
const errors = [];

async function open(query, offline = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => errors.push(e.message));
  if (offline) await page.route("**/api/**", (r) => r.abort());
  await page.goto(`${APP}/${query}`);
  await page.waitForSelector('[data-ready="true"]', { timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  return page;
}
const panel = (page) => page.locator("section[aria-label='Rent split']");
const badge = (page) => panel(page).getByRole("button", { name: /AI check/ });
const badgeText = async (page) => (await badge(page).first().innerText()).replace(/\s+/g, " ").trim();
const total = async (page) => (await panel(page).getByText(/Total \$/).innerText()).trim();

for (const offline of [false, true]) {
  const tag = offline ? "offline" : "online";
  const page = await open("?plan=jvue_3bed", offline);
  await badge(page).first().waitFor({ timeout: 10000 });
  check(/AI check: 2 to review/.test(await badgeText(page)), `${tag}: JVUE default split -> "${await badgeText(page)}"`);
  await badge(page).first().click();
  const details = page.locator("#rent-check-details");
  await details.waitFor();
  const text = await details.innerText();
  check(/balcony/i.test(text) && /Include attached closets/.test(text), `${tag}: details mention the balcony and suggest including closets`);
  check(/\$88 more/.test(text), `${tag}: roommate note quotes the computed $88`);
  if (!offline) await panel(page).screenshot({ path: join(OUT, "rent_check_jvue.png") });

  // Apply suggestion -> closets included, still exact, check for the new inputs comes from the cache
  await details.getByRole("button", { name: "Apply suggestion" }).click();
  await page.waitForTimeout(800);
  check(await panel(page).getByRole("checkbox").isChecked(), `${tag}: suggestion turned "Include attached closets" on`);
  check(/AI check: 1 to review/.test(await badgeText(page)), `${tag}: re-checked inputs -> "${await badgeText(page)}"`);
  check((await total(page)).includes("$4,200 = rent"), `${tag}: total still exact (${await total(page)})`);
  await panel(page).getByRole("checkbox").uncheck({ force: true });

  // a wrong input: private bath on for Bedroom 1 -> flagged, suggestion turns it back off
  await panel(page).locator("[data-room='r4']").getByRole("button", { name: /private bath/i }).click();
  await page.waitForTimeout(800);
  if (!(await page.locator("#rent-check-details").isVisible())) await badge(page).first().click();
  const wrong = await page.locator("#rent-check-details").innerText();
  check(/Turn private bath off for Bedroom 1/.test(wrong), `${tag}: wrong private-bath flag is caught (${(await badgeText(page))})`);
  await page.locator("#rent-check-details").getByRole("button", { name: "Apply suggestion" }).first().click();
  await page.waitForTimeout(800);
  const pressed = await panel(page).locator("[data-room='r4']").getByRole("button", { name: /private bath/i }).getAttribute("aria-pressed");
  check(pressed === "false", `${tag}: Apply suggestion turned Bedroom 1's private bath back off`);
  if (offline) await panel(page).screenshot({ path: join(OUT, "rent_check_offline.png") });
  await page.close();
}

{
  const page = await open("?plan=longwood_2bed");
  await badge(page).first().waitFor({ timeout: 10000 });
  check(/AI checked ✓/.test(await badgeText(page)), `longwood_2bed default -> "${await badgeText(page)}"`);
  await badge(page).first().click();
  await page.locator("#rent-check-details").waitFor();
  await panel(page).screenshot({ path: join(OUT, "rent_check_longwood.png") });
  await page.close();
}

await browser.close();
if (errors.length) console.error("page errors:", errors);
console.log(failures || errors.length ? `\n${failures} check(s) failed, ${errors.length} page error(s)` : "\nall rent check UI checks passed");
process.exit(failures || errors.length ? 1 : 0);
