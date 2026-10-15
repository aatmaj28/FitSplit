// Chat replay (opened from the group page): the conversation box follows new messages only while it is
// near the bottom, nothing else scrolls by itself, "Jump to latest" appears when scrolled up, and
// pause / speed / skip work.
//   (dev server running)  node scripts/e2e-chat.mjs [--offline]
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};

async function run(offline) {
  const tag = offline ? "offline" : "online";
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (offline) await page.route("**/api/**", (r) => r.abort());
  await page.goto(`${APP}/roombae/roommates?with=ananya,meera`);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${APP}/roombae/roommates?with=ananya,meera`);
  await page.locator("[data-pair='priya:ananya']").getByRole("button", { name: "Watch" }).click();
  const box = page.locator("[data-chat-scroll]");
  await box.waitFor({ timeout: 10000 });
  const msgs = () => box.locator("[data-msg]").count();
  const dist = () => box.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  const top = () => box.evaluate((el) => el.scrollTop);
  const overflowing = () => box.evaluate((el) => el.scrollHeight > el.clientHeight + 40);

  await page.getByRole("group", { name: "Replay speed" }).getByRole("button", { name: "4×" }).click();
  check((await page.getByRole("button", { name: "4×" }).getAttribute("aria-pressed")) === "true", `${tag}: speed 4× selected`);
  // the replay opens in a dialog: neither the page nor the dialog may move by itself
  const still = () => page.evaluate(() => window.scrollY + document.querySelector("[data-replay-dialog]").scrollTop);
  for (let i = 0; i < 60 && !(await overflowing()); i++) await page.waitForTimeout(250);
  check(await overflowing(), `${tag}: conversation fills its scroll box`);
  await page.waitForTimeout(1500);
  check((await dist()) <= 60, `${tag}: box follows new messages while at the bottom (${Math.round(await dist())}px from bottom)`);
  check((await still()) === 0, `${tag}: the page and the dialog did not scroll by themselves`);

  // the reader scrolls up: stop following, offer a jump
  await page.getByRole("group", { name: "Replay speed" }).getByRole("button", { name: "1×" }).click();
  const bb = await box.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.wheel(0, -260);
  await page.waitForTimeout(400);
  const held = await top();
  const before = await msgs();
  for (let i = 0; i < 40 && (await msgs()) === before; i++) await page.waitForTimeout(250);
  await page.waitForTimeout(300);
  check((await msgs()) > before, `${tag}: new messages kept arriving`);
  check(Math.abs((await top()) - held) <= 2, `${tag}: scrolled up, the box stays where the reader left it`);
  check((await dist()) > 60, `${tag}: not snapped back to the bottom`);
  const jumpBtn = page.getByRole("button", { name: "Jump to latest ↓" });
  check(await jumpBtn.isVisible(), `${tag}: "Jump to latest ↓" shows`);
  await jumpBtn.click();
  await page.waitForTimeout(900);
  check((await dist()) <= 60, `${tag}: jump scrolls to the newest message`);
  check(!(await jumpBtn.isVisible()), `${tag}: jump button hides at the bottom`);

  // pause / play
  await page.getByRole("button", { name: "Pause" }).click();
  const frozen = await msgs();
  await page.waitForTimeout(2500);
  check((await msgs()) === frozen && (await page.locator("[data-replay]").getAttribute("data-replay")) === "paused", `${tag}: pause stops the replay`);
  await page.getByRole("button", { name: "Play" }).click();
  for (let i = 0; i < 40 && (await msgs()) === frozen; i++) await page.waitForTimeout(250);
  check((await msgs()) > frozen, `${tag}: play resumes it`);

  // skip to verdict lands on the verdict card
  await page.getByRole("button", { name: "Skip to verdict" }).click();
  const verdict = box.locator("[data-verdict]");
  await verdict.waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  const inView = await page.evaluate(() => {
    const b = document.querySelector("[data-chat-scroll]").getBoundingClientRect();
    const v = document.querySelector("[data-chat-scroll] [data-verdict]").getBoundingClientRect();
    return v.top >= b.top - 1 && v.top < b.bottom;
  });
  check(inView, `${tag}: "Skip to verdict" shows the verdict card`);
  check(await page.getByRole("button", { name: "↺ Replay" }).isVisible(), `${tag}: finished chat offers Replay`);
  check(errors.length === 0, `${tag}: no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await page.close();
}

await run(false);
if (process.argv.includes("--offline") || !process.argv.includes("--online-only")) await run(true);
await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall chat checks passed");
process.exit(failures ? 1 : 0);
