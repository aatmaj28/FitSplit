/**
 * Readable rendering of the clones' ACP/1.0 messages (protocol from the ported engine, see
 * backend/app/roommates/modules.py): HI / PFR / CNF / FLX / VRD statements with abbreviated
 * fields, plus <<MOD:NAME>> requests. Anything that isn't a statement stays plain text.
 */

export const STATEMENTS = {
  HI: "Intro",
  PFR: "Preferences",
  CNF: "Friction",
  FLX: "Offer",
  VRD: "Verdict",
} as const;
export type Statement = keyof typeof STATEMENTS;

// ACP_FIELD_TABLE abbreviations, plus the ones the module prompts use
const FIELDS: Record<string, string> = {
  loc: "location", mv: "move-in", bd: "budget", rm: "room", gnd: "gender", smk: "smoking", pet: "pets",
  slp: "sleep", cln: "cleanliness", gwk: "guests/week", usp: "utilities", groc: "groceries", dep: "deposit",
  wfh: "work from home", nzl: "noise", cf: "conflict style", pri: "priorities", nn: "non-negotiables",
  occ: "occupation", drink: "drinking", lease: "lease", bath: "bathroom", wake: "wake-up", cook: "cooking",
  kitchen: "kitchen", common: "common space", guests: "guests", notice: "guest notice", parties: "parties",
  social: "social", quiet: "quiet hours", sched: "schedule", temp: "thermostat", hobbies: "hobbies",
  slp_sched: "sleep", clean_sched: "cleaning", bath_time: "bathroom time", bd_flex: "budget flex",
  pay: "payments", r: "reason", open: "open topics", share: "rent share", offered: "room", furniture: "furniture",
};

export interface Field {
  key: string;
  label: string;
  value: string;
}

export type Part =
  | { kind: "text"; text: string }
  | { kind: "statement"; type: Statement; label: string; fields: Field[]; value: string; raw: string };

const STMT = /\b(HI|PFR|CNF|FLX|VRD)\s*:/g;
const MOD = /<<\s*MOD:\s*(\w+)\s*>>/gi;
const SAY = /^\s*[*_]*\s*SAY\s*[*_]*\s*:/i;

function fieldsOf(body: string): { fields: Field[]; value: string } {
  let s = body.trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  // "a=1|b=2" or "[a:1,b:2]"; commas inside values like "Split basics (condiments, cleaning)" are kept
  const chunks = s.includes("|") ? s.split("|") : s.split(/,\s*(?=[A-Za-z_]{1,14}\s*[:=])/);
  const fields: Field[] = [];
  let value = "";
  for (const chunk of chunks) {
    const c = chunk.trim().replace(/^\[|\]$/g, "");
    if (!c) continue;
    const m = c.match(/^([A-Za-z_]{1,14})\s*[:=]\s*(.*)$/s);
    if (m) {
      const key = m[1].toLowerCase();
      fields.push({ key, label: FIELDS[key] ?? key.replace(/_/g, " "), value: m[2].replace(/^\[|\]$/g, "").trim() });
    } else if (!value) value = c;
    else fields.push({ key: "", label: "", value: c });
  }
  return { fields, value };
}

export function parseAcp(message: string): { parts: Part[]; modules: string[] } {
  const modules = [...message.matchAll(MOD)].map((m) => m[1].toUpperCase());
  const text = message.replace(MOD, " ");
  const parts: Part[] = [];
  for (const line of text.split(/\n+/)) {
    if (SAY.test(line)) continue; // the plain-English line is shown on its own (NegotiationMessage.say)
    const starts = [...line.matchAll(STMT)];
    if (!starts.length) {
      const t = line.trim();
      if (t) parts.push({ kind: "text", text: t });
      continue;
    }
    const lead = line.slice(0, starts[0].index).trim();
    if (lead) parts.push({ kind: "text", text: lead });
    starts.forEach((m, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index : line.length;
      const raw = line.slice(m.index, end).trim();
      const type = m[1] as Statement;
      const { fields, value } = fieldsOf(line.slice(m.index! + m[0].length, end));
      parts.push({ kind: "statement", type, label: STATEMENTS[type], fields, value, raw });
    });
  }
  return { parts, modules };
}
