// The guided demo's step bar follows the current page, keeps the last step on pages that aren't a
// step's, and Next / Back / Shift + arrows work from any page. Shift + arrows nudging a selected
// furniture piece don't change the step.   (dev server running)  node scripts/e2e-stepbar.mjs
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const step = async () => Number(await page.locator("[data-demo-step]").getAttribute("data-demo-step"));
const path = () => new URL(page.url()).pathname + new URL(page.url()).hash;
const settle = (ms = 900) => page.waitForTimeout(ms);
const off = () => page.locator("[data-demo-return]").isVisible();

await page.goto(`${APP}/demo`);
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.goto(`${APP}/demo`);
await page.getByRole("button", { name: "Reset and start the demo" }).click();
await page.waitForURL(/\/leasehub\/listings\/new/);
await page.locator("[data-demo-step]").waitFor();
check((await step()) === 1 && !(await off()), "step 1 on the new-listing page");

// a page that is no step's: the bar keeps step 1 and offers the way back
await page.getByRole("link", { name: "Dashboard" }).click();
await page.waitForURL(/\/leasehub$/);
await settle();
check((await step()) === 1 && (await off()), "LeaseHub dashboard keeps step 1 (not step 6) with a way back");
await page.getByRole("button", { name: "Next →" }).click();
await page.waitForURL(/\/roombae\/discover/);
await settle();
check((await step()) === 2, "Next from the dashboard opens step 2 (Discover)");

// the step bar follows the pages of step 2, and keeps step 2 elsewhere in Roombae
await page.goto(`${APP}/roombae/matches`);
await settle();
check((await step()) === 2 && !(await off()), "My matches is step 2 too");
await page.getByRole("link", { name: "Listings", exact: true }).click();
await page.waitForURL(/\/roombae\/listings$/);
await settle();
check((await step()) === 2 && (await off()), "Listings keeps step 2 with a way back");
await page.locator("[data-demo-return]").click();
await page.waitForURL(/\/roombae\/discover/);
check(true, '"back to step 2" returns to Discover');

// jumping straight to a step's page moves the bar there; Next / Back step from it
await page.goto(`${APP}/roombae/listings/jvue_3bed`);
await page.waitForSelector('[data-ready="true"]', { timeout: 30000 });
check((await step()) === 3, "the JVUE listing page is step 3");
await page.getByRole("button", { name: "Next →" }).click();
await settle(1200);
check((await step()) === 4 && path().endsWith("#rent"), "Next opens step 4 (#rent)");
await page.getByRole("button", { name: "← Back" }).click();
await settle(1200);
check((await step()) === 3, "Back returns to step 3");

// Shift + arrows from a page that isn't a step's
await page.goto(`${APP}/roombae/fill-room`);
await settle(1500);
check((await step()) === 3 && (await off()), "Fill a room keeps step 3");
await page.keyboard.press("Shift+ArrowRight");
await settle(1200);
check((await step()) === 4, "Shift + → from there goes to step 4");

// across portals: LeaseHub's dashboard keeps the step
await page.getByRole("navigation", { name: "Switch portal" }).getByRole("link", { name: /LeaseHub/ }).click();
await page.waitForURL(/\/leasehub$/);
await settle();
check((await step()) === 4, "switching to LeaseHub keeps step 4");
await page.getByRole("button", { name: "Next →" }).click();
await page.waitForURL(/\/roombae\/apply\/jvue_3bed/);
await settle();
check((await step()) === 5, "Next from LeaseHub opens step 5 (apply)");

// Shift + arrows nudge a selected furniture piece instead of changing the step
await page.goto(`${APP}/roombae/listings/jvue_3bed`);
await page.waitForSelector('[data-ready="true"]', { timeout: 30000 });
await page.locator("section[aria-label='Rent split'] [data-room]").first().click();
await page.getByRole("button", { name: "Edit layout" }).click();
await page.getByRole("button", { name: "Will my stuff fit?" }).click();
await page.getByRole("button", { name: "More Queen bed", exact: true }).click();
await page.getByRole("button", { name: /Place 1 along the walls/ }).click();
await settle(800);
const layout = () => page.evaluate(() => JSON.parse(localStorage.getItem("fp3d.layout.v1:jvue_3bed") ?? "[]"));
const before = (await layout())[0];
await page.getByRole("button", { name: /Queen bed/ }).filter({ hasText: '"' }).first().click();
await page.keyboard.press("Shift+ArrowRight");
await settle(800);
const after = (await layout())[0];
check((await step()) === 3 && Math.abs(after.x - before.x - 1) < 0.01, `Shift + → nudges the selected bed 1 ft and stays on step 3 (x ${before.x.toFixed(2)} → ${after.x.toFixed(2)})`);
// minimize: a small pill, remembered for the session; the keys keep working
await page.getByRole("button", { name: "Minimize step bar" }).click();
const pill = page.getByRole("button", { name: /Expand the step bar/ });
check((await pill.isVisible()) && /Step 3 of 6/.test(await pill.textContent()), "minimized, the bar is a \"Step 3 of 6\" pill");
const pb = await pill.boundingBox();
const vw = page.viewportSize();
check(pb.x + pb.width > vw.width - 40 && pb.y + pb.height > vw.height - 40, "the pill sits in the bottom right corner");
await page.keyboard.press("Escape");
await page.keyboard.press("PageDown");
await settle(1200);
check((await step()) === 4 && (await pill.isVisible()), "Page Down still moves on while minimized (step 4, still a pill)");
await page.reload();
await settle(1200);
check(await page.getByRole("button", { name: /Expand the step bar/ }).isVisible(), "minimized state survives a reload");
await page.getByRole("button", { name: /Expand the step bar/ }).click();
check(await page.getByRole("button", { name: "Next →" }).isVisible(), "clicking the pill expands the bar again");
check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall step bar checks passed");
process.exit(failures ? 1 : 0);
