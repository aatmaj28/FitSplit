// Discover (swipe to match) end to end: the filtered deck, drag / keys / buttons, "clones are talking",
// the match and "didn't click" screens, the replay, My matches, the group and listings that fit,
// swipes kept across reloads and cleared by Reset demo. Online, with the backend blocked, and on a phone.
//   (dev server running)  node scripts/e2e-swipe.mjs [--online-only]
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};

async function run(tag, { offline = false, phone = false } = {}) {
  const page = await browser.newPage(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (offline) await page.route("**/api/**", (r) => r.abort());
  await page.goto(`${APP}/roombae/discover?listing=jvue_3bed`);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${APP}/roombae/discover?listing=jvue_3bed`);
  const deckEl = page.locator("[data-deck]");
  await page.locator("[data-card]").waitFor({ timeout: 15000 });
  const deck = () => deckEl.getAttribute("data-deck");
  const top = () => page.locator("[data-card]").getAttribute("data-card");

  check((await deck()) === "ananya,jake,kavya,meera,rohan", `${tag}: deck is same-city students by name (${await deck()})`);
  const filters = await page.locator("[data-deck-filters]").textContent();
  check(/Daniel Kim hidden: lives in another city/.test(filters) && /Marcus Lee hidden: wants a same-gender roommate/.test(filters) && /Arjun Reddy hidden: already has a place/.test(filters),
    `${tag}: other city, same-gender-only and hosts are filtered out`);
  check(await page.locator("[data-card] img").first().evaluate((img) => img.complete && img.naturalWidth > 0), `${tag}: illustrated avatar loaded (bundled SVG)`);

  // a short drag springs back
  const drag = async (dx) => {
    const bb = await page.locator("[data-card]").boundingBox();
    const x = bb.x + bb.width / 2, y = bb.y + bb.height * 0.6;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + 4, { steps: 6 });
    await page.mouse.move(x + dx, y + 6, { steps: 6 });
    await page.mouse.up();
  };
  await drag(50);
  await page.waitForTimeout(700);
  const back = await page.locator("[data-card]").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  check((await top()) === "ananya" && Math.abs(back) < 2, `${tag}: a short drag springs back (x = ${back.toFixed(1)})`);

  // 1. drag Ananya right: talking, then a match
  await drag(240);
  await page.locator("[data-flow='talking']").waitFor({ timeout: 5000 });
  check(true, `${tag}: swipe right shows "Your clones are talking"`);
  const match = page.locator("[data-flow='match']");
  await match.waitFor({ timeout: 15000 });
  check((await match.getAttribute("data-verdict")) === "strong" && (await page.getByText("It's a match!").isVisible()), `${tag}: Ananya is a strong match`);
  check(/\d+\/100/.test(await match.textContent()), `${tag}: match screen shows the score and top sub-scores`);
  await page.getByRole("button", { name: "Watch the conversation" }).click();
  const dialog = page.locator("[data-replay-dialog]");
  await dialog.waitFor({ timeout: 5000 });
  await dialog.locator("[data-msg]").first().waitFor({ timeout: 8000 });
  check(true, `${tag}: "Watch the conversation" replays the chat`);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 3000 });
  await page.getByRole("button", { name: "Keep swiping" }).click();
  await page.waitForTimeout(400);

  // 2. arrow key on Jake: didn't click
  check((await top()) === "jake", `${tag}: next card is Jake`);
  await page.keyboard.press("ArrowRight");
  const noclick = page.locator("[data-flow='noclick']");
  await noclick.waitFor({ timeout: 15000 });
  const reason = await page.locator("[data-noclick-reason]").textContent();
  check(/Jake smokes/.test(reason), `${tag}: Jake "didn't click": ${reason}`);
  await page.getByRole("button", { name: "Keep swiping" }).click();
  await page.waitForTimeout(400);

  // 3. pass on Kavya with the button
  await page.getByRole("button", { name: "Pass" }).click();
  await page.waitForTimeout(800);
  check((await top()) === "meera" && !(await page.locator("[data-flow]").count()), `${tag}: ✕ passes Kavya without a conversation`);

  // reload: swipes are kept
  await page.reload();
  await page.locator("[data-card]").waitFor({ timeout: 10000 });
  check((await deck()) === "meera,rohan", `${tag}: swipes survive a reload (${await deck()})`);

  // 4. like Meera with the button, then find a place together
  await page.getByRole("button", { name: "Like" }).click();
  await match.waitFor({ timeout: 15000 });
  check((await match.getAttribute("data-verdict")) === "conditional", `${tag}: Meera is a conditional match`);
  check(/Still to agree on/.test(await match.textContent()), `${tag}: conditional match lists what is still open`);
  await page.getByRole("button", { name: "Find a place together" }).click();
  await page.waitForURL(/\/roombae\/roommates\?with=/);
  const group = page.locator("[data-group]");
  await group.waitFor({ timeout: 10000 });
  check((await group.getAttribute("data-group")) === "ananya,meera,priya", `${tag}: group is Priya, Ananya, Meera`);
  await page.locator("[data-fit='jvue_3bed']").getByText("Fits every budget").waitFor({ timeout: 15000 });
  check(true, `${tag}: JVUE 3 bed fits every budget`);

  // My matches: counts, incompatible toggle, replay
  await page.getByRole("link", { name: /Matches/i }).click();
  await page.locator("[data-counts]").waitFor({ timeout: 10000 });
  check((await page.locator("[data-counts]").getAttribute("data-counts")) === "1,1,1", `${tag}: My matches counts 1 strong, 1 conditional, 1 incompatible`);
  check((await page.locator("[data-match]").count()) === 2, `${tag}: incompatible hidden by default`);
  await page.getByLabel("Show incompatible").check();
  check((await page.locator("[data-match]").count()) === 3, `${tag}: "Show incompatible" shows Jake`);
  await page.locator("[data-match='meera']").getByRole("button", { name: "Watch the conversation" }).click();
  await dialog.locator("[data-msg]").first().waitFor({ timeout: 8000 });
  check(true, `${tag}: My matches opens the replay`);
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Find a place together →" }).click();
  await page.waitForURL(/\/roombae\/roommates\?with=/);
  await group.waitFor({ timeout: 10000 });
  await page.locator("[data-fit='jvue_3bed']").getByRole("button", { name: /Save group/ }).click();
  await page.waitForURL(/\/roombae\/listings\/jvue_3bed/);
  check(true, `${tag}: saving the group opens the listing (3D, rent split, apply)`);

  // Reset demo clears the swipes
  await page.goto(`${APP}/`);
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await page.goto(`${APP}/roombae/discover`);
  await page.locator("[data-card]").waitFor({ timeout: 10000 });
  check((await deck()) === "ananya,jake,kavya,meera,rohan", `${tag}: Reset demo restores the full deck`);
  check(errors.length === 0, `${tag}: no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await page.close();
}

await run("online");
if (!process.argv.includes("--online-only")) {
  await run("offline", { offline: true });
  await run("phone", { phone: true });
}
await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall swipe checks passed");
process.exit(failures ? 1 : 0);
