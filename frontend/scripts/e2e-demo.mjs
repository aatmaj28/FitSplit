// End-to-end check of the guided demo (both portals), online and with the backend blocked, plus
// screenshots of every demo step and the main screens of both portals into docs/screenshots/.
//   (dev server running)  node scripts/e2e-demo.mjs [--offline-only] [--no-shots]
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "screenshots");
const shots = !process.argv.includes("--no-shots");
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};

async function flow(offline) {
  const tag = offline ? "offline" : "online";
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: shots && !offline ? 2 : 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (offline) await page.route("**/api/**", (r) => r.abort());
  const shot = async (name, locator) => {
    if (!shots || offline) return;
    // element shots: the floating demo bar would cover the bottom of the element
    if (locator) await page.addStyleTag({ content: "[data-demo-step]{visibility:hidden!important}" });
    await (locator ?? page).screenshot({ path: join(OUT, name) });
    if (locator) await page.addStyleTag({ content: "[data-demo-step]{visibility:visible!important}" });
  };
  const step = async (expect) => {
    if (expect) await page.waitForSelector(`[data-demo-step="${expect}"]`, { timeout: 5000 }).catch(() => {});
    return Number(await page.locator("[data-demo-step]").getAttribute("data-demo-step"));
  };
  const next = async () => {
    await page.getByRole("button", { name: "Next →" }).click();
    await page.waitForTimeout(1200);
  };

  // 0. start: reset + step 1
  await page.goto(`${APP}/demo`);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${APP}/demo`);
  await shot("demo_start.png");
  await page.getByRole("button", { name: "Reset and start the demo" }).click();
  await page.waitForURL(/\/leasehub\/listings\/new/);
  check((await step(1)) === 1, `${tag}: demo starts at step 1 (agent posts listing)`);

  // 1. agent: sample JVUE 3 bed -> parse -> 3D -> publish
  await page.locator("[data-sample='jvue_3bed']").click();
  await page.waitForSelector('[data-ready="true"]', { timeout: 30000 });
  check(await page.getByText(/Parsed in/).isVisible(), `${tag}: plan parsed (cached) with 3D preview`);
  check((await page.locator("input[type=number]").first().inputValue()) === "4200", `${tag}: rent auto-filled from the plan's listing data`);
  await page.waitForTimeout(800);
  await shot("demo_step1_new_listing.png");
  await page.getByRole("button", { name: "3. Publish listing" }).click();
  await page.getByText("Syndicated to YGL ✓").waitFor({ timeout: 8000 });
  check(true, `${tag}: published, syndication badges ticked`);
  await shot("demo_step1_published.png");

  // 2. students match: swipe right on Ananya (match) and Jake (didn't click), pass Kavya, like Meera
  await next();
  check((await step(2)) === 2 && page.url().includes("/roombae/discover"), `${tag}: step 2 opens Discover (swipe to match)`);
  await page.locator("[data-card]").waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  await shot("demo_step2_deck.png");
  await page.keyboard.press("ArrowRight"); // Ananya
  await page.locator("[data-flow='talking']").waitFor({ timeout: 5000 });
  await page.waitForTimeout(1500);
  await shot("demo_step2_talking.png");
  const match = page.locator("[data-flow='match']");
  await match.waitFor({ timeout: 15000 });
  check((await match.getAttribute("data-verdict")) === "strong", `${tag}: Ananya: it's a match (strong)`);
  await page.waitForTimeout(500);
  await shot("demo_step2_match.png");
  await page.getByRole("button", { name: "Keep swiping" }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press("ArrowRight"); // Jake
  await page.locator("[data-flow='noclick']").waitFor({ timeout: 15000 });
  check(/smokes/.test(await page.locator("[data-noclick-reason]").textContent()), `${tag}: Jake: the clones didn't click (smoking)`);
  await page.waitForTimeout(500);
  await shot("demo_step2_noclick.png");
  await page.getByRole("button", { name: "Keep swiping" }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press("ArrowLeft"); // Kavya: pass
  await page.waitForTimeout(800);
  await page.keyboard.press("ArrowRight"); // Meera
  await match.waitFor({ timeout: 15000 });
  check((await match.getAttribute("data-verdict")) === "conditional", `${tag}: Meera: it's a match (conditional)`);
  await page.getByRole("button", { name: "Find a place together" }).click();
  await page.waitForURL(/\/roombae\/roommates/);
  check((await step(2)) === 2, `${tag}: the step bar stays on step 2 on the group page`);
  const group = page.locator("[data-group]");
  await group.waitFor({ timeout: 10000 });
  check((await group.getAttribute("data-group")) === "ananya,meera,priya", `${tag}: matched group is Priya, Ananya, Meera`);
  await page.locator("[data-fit='jvue_3bed']").getByText("Fits every budget").waitFor({ timeout: 15000 });
  check(true, `${tag}: JVUE 3 bed fits every budget`);
  await shot("demo_step2_group.png", group);
  await page.locator("[data-fit='jvue_3bed']").getByRole("button", { name: /Save group/ }).click();
  await page.waitForURL(/\/roombae\/listings\/jvue_3bed/);

  // 3. 3D + furniture
  check((await step(3)) === 3, `${tag}: saving the group lands on step 3 (3D + furniture)`);
  await page.waitForSelector('[data-ready="true"]', { timeout: 30000 });
  await page.locator("section[aria-label='Rent split'] [data-room]").first().click();
  await page.getByRole("button", { name: "Edit layout" }).click();
  await page.getByRole("button", { name: "Will my stuff fit?" }).click();
  for (const name of ["Queen bed", "Desk", "Dresser"]) await page.getByRole("button", { name: `More ${name}`, exact: true }).click();
  await page.getByRole("button", { name: /Place 3 along the walls/ }).click();
  await page.getByText(/All 3 fit in DREAM/).waitFor({ timeout: 8000 });
  check(true, `${tag}: queen bed + desk + dresser fit in Bedroom 1`);
  await page.waitForTimeout(1800);
  await shot("demo_step3_furniture.png");

  // 4. rent split + AI check
  await next();
  check((await step(4)) === 4, `${tag}: step 4 (rent split + AI check)`);
  const badge = page.locator("section[aria-label='Rent split']").getByRole("button", { name: /AI check/ });
  await badge.waitFor({ timeout: 10000 });
  check(/2 to review/.test(await badge.innerText()), `${tag}: AI check badge on the split (${(await badge.innerText()).trim()})`);
  await badge.click();
  await page.locator("#rent-check-details").waitFor();
  await shot("demo_step4_rent_check.png", page.locator("section[aria-label='Rent split']"));

  // 5. apply as a group
  await next();
  check((await step(5)) === 5, `${tag}: step 5 (apply as a group)`);
  await page.locator("[data-member='meera']").waitFor({ timeout: 15000 });
  const members = await page.locator("[data-member]").evaluateAll((els) => els.map((e) => e.getAttribute("data-member")));
  check(members.join(",") === "priya,ananya,meera", `${tag}: applicants auto-filled (${members.join(", ")})`);
  await page.getByText("$4,200 = rent ✓").first().waitFor({ timeout: 8000 });
  check(true, `${tag}: shares add up to the rent`);
  await shot("demo_step5_apply.png");
  await page.getByRole("button", { name: /Submit group application/ }).click();
  await page.locator("[data-applied]").waitFor();

  // 6. agent receives it
  await next();
  check((await step(6)) === 6 && page.url().includes("/leasehub/applications/"), `${tag}: step 6 opens the application in LeaseHub`);
  const view = page.locator("[data-application-view]");
  await view.waitFor();
  const text = await view.innerText();
  check(/Priya Sharma/.test(text) && /Ananya Iyer/.test(text) && /Meera Patel/.test(text), `${tag}: agent sees all three roommates`);
  check(/\$4,200\s*= rent ✓/.test(text), `${tag}: agent sees shares totalling the rent`);
  check(/AI check/.test(text) && /Strong match|Conditional match/.test(text), `${tag}: agent sees the AI rent check and the compatibility verdict`);
  await shot("demo_step6_application.png");

  // the dashboard now lists the new application
  await page.goto(`${APP}/leasehub`);
  await page.locator("[data-application]").first().waitFor();
  check((await page.locator("[data-application]").count()) === 2, `${tag}: dashboard shows the new application next to the sample one`);
  await shot("leasehub_dashboard.png");
  check(errors.length === 0, `${tag}: no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await page.close();
}

async function portalShots() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
  const go = async (path, wait = 1500) => {
    await page.goto(`${APP}${path}`);
    await page.waitForTimeout(wait);
  };
  await go("/", 800);
  await page.screenshot({ path: join(OUT, "landing.png") });
  await go("/roombae");
  await page.screenshot({ path: join(OUT, "roombae_home.png") });
  await go("/roombae/listings", 2500);
  await page.screenshot({ path: join(OUT, "roombae_listings.png"), fullPage: true });
  // Discover: the deck, then three likes and a pass, then My matches with every verdict
  await go("/roombae/discover", 1500);
  await page.screenshot({ path: join(OUT, "roombae_discover_deck.png") });
  for (const key of ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowRight"]) {
    await page.keyboard.press(key);
    if (key === "ArrowLeft") {
      await page.waitForTimeout(800);
      continue;
    }
    await page.locator("[data-flow='match'], [data-flow='noclick']").waitFor({ timeout: 15000 });
    await page.waitForTimeout(700);
    const flow = await page.locator("[data-flow='match'], [data-flow='noclick']").getAttribute("data-flow");
    await page.screenshot({ path: join(OUT, flow === "match" ? `roombae_discover_match_${await page.locator("[data-flow='match']").getAttribute("data-verdict")}.png` : "roombae_discover_didnt_click.png") });
    await page.getByRole("button", { name: "Keep swiping" }).click();
    await page.waitForTimeout(500);
  }
  await go("/roombae/matches", 1500);
  await page.getByLabel("Show incompatible").check();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "roombae_my_matches.png") });
  // the replay: plain-English lines, protocol details folded, replay controls
  await page.locator("[data-match='meera']").getByRole("button", { name: "Watch the conversation" }).click();
  await page.locator("[data-replay-dialog] [data-msg]").first().waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "2×" }).click();
  await page.waitForTimeout(6000);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, "roombae_replay.png") });
  await page.keyboard.press("Escape");
  await go("/roombae/fill-room", 2500);
  await page.locator("[data-candidate='rohan']").click();
  await page.waitForTimeout(5000); // a few turns of Rohan + Arjun playing back
  await page.screenshot({ path: join(OUT, "roombae_fill_room.png") });
  await page.getByRole("button", { name: "Skip to verdict" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("tab", { name: /with Sofia/ }).click();
  await page.getByRole("button", { name: "Skip to verdict" }).click();
  const verdict = page.locator("[data-group-verdict]");
  await verdict.waitFor({ timeout: 10000 });
  console.log("fill a room, Rohan:", await verdict.getAttribute("data-group-verdict"));
  await page.waitForTimeout(1500);
  await verdict.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, "roombae_fill_room_verdict.png") });
  await go("/leasehub/listings/jvue_3bed", 3500);
  await page.screenshot({ path: join(OUT, "leasehub_listing.png") });
  await page.close();
}

if (!process.argv.includes("--offline-only")) {
  await flow(false);
  if (shots) await portalShots();
}
await flow(true);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall demo checks passed");
process.exit(failures ? 1 : 0);
