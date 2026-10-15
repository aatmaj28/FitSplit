// Navigation: the landing page's three entries, and in both portals the logo (portal home), the
// "Home" link (back to /) and the Roombae / LeaseHub switcher.
//   (dev server running)  node scripts/e2e-nav.mjs
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const path = () => new URL(page.url()).pathname;

await page.goto(`${APP}/`);
await page.locator("[data-entry]").first().waitFor();
const entries = await page.locator("[data-entry]").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
check(JSON.stringify(entries) === JSON.stringify(["/roombae", "/leasehub", "/demo"]), `landing has the three entries (${entries.join(", ")})`);

for (const [entry, portal, other, deep] of [["/roombae", "roombae", "leasehub", "/roombae/listings/jvue_3bed"], ["/leasehub", "leasehub", "roombae", "/leasehub/listings/new"]]) {
  const name = portal === "roombae" ? "Roombae" : "LeaseHub";
  await page.goto(`${APP}/`);
  await page.locator(`[data-entry="${entry}"]`).click();
  await page.waitForURL(`**${entry}`);
  check(path() === entry, `landing card opens ${name}`);
  await page.goto(`${APP}${deep}`);
  await page.getByRole("link", { name: `${name} home` }).click();
  await page.waitForURL(`**${entry}`);
  check(path() === entry, `${name}: logo goes to the portal home from ${deep}`);
  const sw = page.getByRole("navigation", { name: "Switch portal" });
  check((await sw.getByRole("link", { name: new RegExp(name) }).getAttribute("aria-current")) === "page", `${name}: switcher marks ${name} as current`);
  await sw.getByRole("link", { name: new RegExp(other === "roombae" ? "Roombae" : "LeaseHub") }).click();
  await page.waitForURL(`**/${other}`);
  check(path() === `/${other}`, `${name}: switcher opens the other portal`);
  await page.goto(`${APP}${deep}`);
  await page.getByRole("link", { name: "Home", exact: false }).first().click();
  await page.waitForURL(`${APP}/`);
  check(path() === "/", `${name}: Home goes back to /`);
}
check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall navigation checks passed");
process.exit(failures ? 1 : 0);
