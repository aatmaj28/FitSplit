// Illustrated avatars for the sample students, written once to public/demo/avatars/<id>.svg so the
// app needs no network and no avatar library at runtime. Style: DiceBear "Notionists" (artwork by
// Zoish, CC0 1.0; DiceBear code MIT). Each look is picked by hand; unknown ids fall back to initials.
//   node scripts/make-avatars.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAvatar } from "@dicebear/core";
import * as notionists from "@dicebear/notionists";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "demo", "avatars");
const LOOK = {
  priya: { hair: ["variant28"], lips: ["variant03"] },
  ananya: { hair: ["variant46"], lips: ["variant05"] },
  meera: { hair: ["variant36"], lips: ["variant14"], glassesProbability: 100, glasses: ["variant08"] },
  arjun: { hair: ["variant13"], lips: ["variant20"], glassesProbability: 100, glasses: ["variant03"] },
  sofia: { hair: ["variant41"], lips: ["variant03"] },
  rohan: { hair: ["variant24"], lips: ["variant05"] },
  jake: { hair: ["variant20"], lips: ["variant20"], beardProbability: 100, beard: ["variant06"] },
  kavya: { hair: ["variant48"], lips: ["variant14"] },
  daniel: { hair: ["variant49"], lips: ["variant03"] },
  marcus: { hair: ["variant16"], lips: ["variant05"] },
};
const profiles = JSON.parse(readFileSync(join(ROOT, "public", "demo", "roommates", "profiles.json"), "utf8"));
mkdirSync(OUT, { recursive: true });
for (const p of profiles) {
  const svg = createAvatar(notionists, {
    seed: p.name, beardProbability: 0, glassesProbability: 0, gestureProbability: 0, bodyIconProbability: 0, ...(LOOK[p.id] ?? {}),
  }).toString();
  writeFileSync(join(OUT, `${p.id}.svg`), svg);
}
writeFileSync(join(OUT, "index.json"), JSON.stringify(profiles.map((p) => p.id)));
console.log(`wrote ${profiles.length} avatars to public/demo/avatars`);
