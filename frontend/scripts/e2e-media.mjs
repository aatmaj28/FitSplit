// Listing video / photos (LeaseHub "Video or photos" -> Roombae listing): opens a finished media job
// (MEDIA_JOB, default: the newest one the backend lists), checks the results screen (amenity chips
// with photo evidence, confirm / remove / undo, "Missing from your listing", description editor),
// publishes a new listing and checks Roombae shows its photos, amenities and description.
// Never starts a new job, so it makes no model calls.
//   (dev server + backend running)  node scripts/e2e-media.mjs
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const API = process.env.API_URL ?? "http://localhost:8000";
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};
const jobs = await fetch(`${API}/api/media/jobs`).then((r) => r.json()).catch(() => []);
const JOB = process.env.MEDIA_JOB ?? jobs[0]?.id;
if (!JOB) {
  console.log("no finished media job to open (upload a video first)");
  process.exit(1);
}
const job = await fetch(`${API}/api/media/jobs/${JOB}`).then((r) => r.json());

for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
  const phone = viewport.width < 500;
  const tag = phone ? "[phone]" : "[laptop]";
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${APP}/leasehub`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${APP}/leasehub/listings/new`);
  await page.locator('[data-source="video"]').click();
  check(new URL(page.url()).searchParams.get("source") === "video", `${tag} the switch puts ?source=video in the URL`);
  await page.locator(`[data-media-job="${JOB}"]`).click();
  await page.locator(`[data-media-results="${JOB}"]`).waitFor({ timeout: 15000 });
  const chips = await page.locator("[data-amenity]").count();
  check(chips === job.amenities.length, `${tag} one chip per amenity (${chips}/${job.amenities.length})`);
  const filters = Number(await page.locator("[data-filter-count]").getAttribute("data-filter-count"));
  check(filters > 0, `${tag} "matches N more common renter filters" (N = ${filters})`);
  const first = await page.locator("[data-missing] li").first().textContent();
  check(/found in photo \d+\. Renters filtering for .+ would have missed you\./.test(first ?? ""), `${tag} callout line: "${first?.trim()}"`);

  // evidence: hover shows the photo, click opens the viewer; Esc closes it
  const a = job.amenities[0];
  const chip = page.locator(`[data-amenity="${a.id}"]`);
  if (!phone) {
    await chip.hover();
    check(await chip.locator('[role="tooltip"] img').isVisible(), `${tag} hovering ${a.label} shows its photo`);
  }
  await chip.locator("button").first().click();
  await page.locator("[data-photo-viewer]").waitFor();
  check((await page.locator("[data-photo-viewer]").textContent()).includes(`Photo ${a.evidence[0]}`), `${tag} the viewer opens on photo ${a.evidence[0]}`);
  await page.keyboard.press("Escape");
  check((await page.locator("[data-photo-viewer]").count()) === 0, `${tag} Esc closes the viewer`);

  // walkthrough (when the job has one): drag, hotspot to the next room, ↓ back, minimap
  if (job.walkthrough?.rooms?.length) {
    const walk = job.walkthrough;
    await page.locator('[data-view-tab="walk"]').click();
    const viewer = page.locator("[data-walkthrough]");
    await viewer.waitFor();
    const entrance = walk.rooms.find((r) => r.id === walk.entrance) ?? walk.rooms[0];
    check((await page.locator("[data-room-label]").textContent()) === entrance.name, `${tag} the walkthrough starts in ${entrance.name}`);
    check((await page.locator("[data-minimap]").count()) === 1, `${tag} minimap shows where you are`);
    if (entrance.pano) {
      const before = await page.locator("[data-pano-x]").getAttribute("data-pano-x");
      const box = await page.locator("[data-pano]").boundingBox();
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
      check((await page.locator("[data-pano-x]").getAttribute("data-pano-x")) !== before, `${tag} dragging looks around the panorama`);
    }
    const next = entrance.hotspots[0];
    if (next) {
      // the door may be off screen after the drag (phone): a click event still reaches it
      await viewer.locator(`[data-hotspot="${next.to}"]`).first().dispatchEvent("click");
      await page.waitForTimeout(600);
      check((await page.locator("[data-room-label]").textContent()) === next.name, `${tag} the hotspot walks to ${next.name}`);
      await viewer.focus();
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(600);
      check((await page.locator("[data-room-label]").textContent()) === entrance.name, `${tag} ↓ goes back to ${entrance.name}`);
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(600);
      const names = entrance.hotspots.map((h) => h.name);
      const now = await page.locator("[data-room-label]").textContent();
      check(names.includes(now), `${tag} ↑ goes through the door in view (${now})`);
    }
    await page.locator('[data-view-tab="amenities"]').click();
  }

  // estimated floor plan (when the job has one): labelled, every size with ≈ and ±
  if (job.plan) {
    await page.locator('[data-view-tab="plan"]').click();
    await page.locator("[data-estimated-plan] [data-ready=true]").waitFor({ timeout: 20000 });
    const badge = await page.locator("[data-estimated-plan] [data-estimated]").first().textContent();
    check(/^Estimated from photos ±\d+%$/.test(badge ?? ""), `${tag} the 3D plan says "${badge}"`);
    const rows = await page.locator("[data-estimated-plan] tr").allTextContents();
    check(rows.length === job.plan.rooms.length && rows.every((t) => /≈ .*±\d+%.*≈ \d+ sq ft/.test(t)), `${tag} every room size reads "≈ … ±N%" (${rows.length} rooms)`);
    await page.locator('[data-view-tab="amenities"]').click();
  }

  // remove + undo, confirm
  await chip.getByRole("button", { name: `Remove ${a.label}` }).click();
  check((await page.locator(`[data-amenity="${a.id}"]`).count()) === 0, `${tag} ✕ removes ${a.label}`);
  await page.getByRole("button", { name: "undo" }).first().click();
  check((await page.locator(`[data-amenity="${a.id}"]`).count()) === 1, `${tag} undo brings it back`);
  const b = job.amenities[1];
  await page.getByRole("button", { name: `Remove ${b.label}` }).click();
  await page.getByRole("button", { name: `Confirm ${a.label}` }).click();
  check((await page.getByRole("button", { name: `Unconfirm ${a.label}` }).getAttribute("aria-pressed")) === "true", `${tag} ✓ confirms ${a.label}`);

  // description editor, details, publish
  const full = page.locator("[data-desc-full]");
  check((await full.inputValue()).length > 40, `${tag} the description is filled in`);
  await full.fill("Edited: bright rooms and a dishwasher.");
  await page.locator("[data-media-title]").fill("Video listing test");
  await page.locator('[data-media-field="rent"]').fill("2400");
  await page.locator("[data-media-publish]").click();
  await page.locator("[data-media-published]").waitFor({ timeout: 6000 });
  check(true, `${tag} publish syndicates the listing`);
  await page.getByRole("link", { name: "See it on Roombae" }).click();
  if (job.walkthrough?.rooms?.length) {
    await page.locator("[data-walkthrough]").waitFor({ timeout: 10000 });
    check(true, `${tag} Roombae opens the new listing on its walkthrough`);
    await page.locator('[data-view-tab="photos"]').click();
  }
  await page.locator("[data-photo-gallery]").waitFor({ timeout: 10000 });
  check(true, `${tag} Roombae shows the listing's photos`);
  if (job.plan) {
    await page.locator('[data-view-tab="3d"]').click();
    await page.locator("[data-ready=true]").first().waitFor({ timeout: 20000 });
    check((await page.locator("[data-estimated]").count()) >= 2, `${tag} Roombae 3D view and rent split are labelled as estimated`);
    const label = page.locator("button", { hasText: /≈ \d+ sq ft/ }).first();
    check((await label.count()) === 1, `${tag} room labels read "≈ N sq ft"`);
    await label.dispatchEvent("click"); // on a phone the label may sit under the wrapped toolbar
    await page.locator("[data-estimate-note]").waitFor({ timeout: 5000 });
    check(/Estimated from photos ±\d+%/.test(await page.locator("[data-estimate-note]").textContent()), `${tag} the room panel explains the estimate`);
    check(Number(await page.locator("[data-room-photos]").getAttribute("data-room-photos")) > 0, `${tag} the room panel shows that room's photos`);
    // lived-in look is on for listings; furnished view places furniture with the fit check
    check((await page.locator("[data-lived-in]").getAttribute("data-lived-in")) === "true", `${tag} listing 3D opens in the lived-in look`);
    await page.getByRole("button", { name: "Close" }).first().click(); // the room panel covers the right of the toolbar
    await page.locator('[data-toggle="furnished"]').click();
    await page.waitForFunction(() => Number(document.querySelector("[data-furnished]")?.getAttribute("data-furnished") ?? 0) > 0, null, { timeout: 8000 });
    check(true, `${tag} furnished view places furniture (${await page.locator("[data-furnished]").getAttribute("data-furnished")} pieces)`);
  }
  await page.locator("[data-listing-media]").waitFor();
  const shown = await page.locator("[data-listing-media] [data-amenity]").count();
  check(shown === job.amenities.length - 1, `${tag} Roombae shows the kept amenities (${shown}, one removed)`);
  check((await page.locator("[data-description]").textContent()).includes("Edited: bright rooms"), `${tag} Roombae shows the edited description`);
  await page.locator("[data-listing-media] [data-amenity] button").first().click();
  await page.locator("[data-photo-viewer]").waitFor();
  await page.keyboard.press("Escape");
  check((await page.locator("[data-photo-viewer]").count()) === 0, `${tag} Roombae amenity opens its photo`);
  await page.goto(`${APP}/roombae/listings`);
  await page.locator(`[data-listing="media_${JOB.slice(3)}"]`).waitFor();
  check(true, `${tag} the new listing is on the Roombae listings page`);
  await page.goto(`${APP}/roombae/listings/jvue_3bed`);
  await page.locator("canvas").first().waitFor({ timeout: 15000 });
  check((await page.locator("[data-view-tab]").count()) === 0, `${tag} floor plan listings keep the 3D view alone`);
  check((await page.locator("[data-lived-in]").getAttribute("data-lived-in")) === "true", `${tag} floor plan listings open lived-in too`);
  await page.locator('[data-toggle="furnished"]').click();
  await page.waitForFunction(() => Number(document.querySelector("[data-furnished]")?.getAttribute("data-furnished") ?? 0) >= 6, null, { timeout: 8000 });
  check(true, `${tag} JVUE 3 bed furnished (${await page.locator("[data-furnished]").getAttribute("data-furnished")} pieces)`);
  await page.locator('[data-toggle="lived-in"]').click();
  check((await page.locator("[data-lived-in]").getAttribute("data-lived-in")) === "false", `${tag} Lived-in toggles back to plan colors`);
  check(errors.length === 0, `${tag} no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await page.close();
}
await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall media checks passed");
process.exit(failures ? 1 : 0);
