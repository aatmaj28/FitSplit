import { useEffect, useMemo, useState } from "react";

export interface ChatMessage {
  from: string; // profile id
  text: string;
  at: string; // ISO time
}

const KEY = "fitsplit.groupchat.v1:"; // cleared by Reset demo (every fitsplit.* key)

// a friendly start for the demo group, minutes before "now"
const SEED: Record<string, { from: string; text: string; ago: number }[]> = {
  "ananya+meera+priya": [
    { from: "ananya", text: "Hi you two! Our clones say we'd make a great home 😊", ago: 26 * 60 + 12 },
    { from: "meera", text: "Ha, they did all the awkward talking for us. Fair warning: I'm the night owl 🦉", ago: 26 * 60 + 9 },
    { from: "priya", text: "All good, quiet after 11:30 like they agreed. I saved the JVUE 3 bed, it's a short walk to Northeastern.", ago: 25 * 60 + 40 },
    { from: "ananya", text: "Can I take the room with the most morning light? I'm up early for lab ☀️", ago: 3 * 60 + 5 },
    { from: "meera", text: "Sure! I'll set up Splitwise for utilities this weekend.", ago: 2 * 60 + 48 },
  ],
};

function seed(key: string, now: number): ChatMessage[] {
  return (SEED[key] ?? []).map((m) => ({ from: m.from, text: m.text, at: new Date(now - m.ago * 60_000).toISOString() }));
}

/** The group's chat: a few seeded messages, plus what you type (kept in this browser). */
export function useGroupChat(key: string): [ChatMessage[], (from: string, text: string) => void] {
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY + key) ?? "[]") as ChatMessage[];
    } catch {
      return [];
    }
  };
  const base = useMemo(() => seed(key, Date.now()), [key]);
  const [mine, setMine] = useState<ChatMessage[]>(read);
  useEffect(() => setMine(read()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = (from: string, text: string) => {
    const msg = { from, text: text.trim().slice(0, 1000), at: new Date().toISOString() };
    if (!msg.text) return;
    setMine((prev) => {
      const next = [...prev, msg];
      try {
        localStorage.setItem(KEY + key, JSON.stringify(next));
      } catch {
        /* storage unavailable: keep it for this visit */
      }
      return next;
    });
  };
  return [[...base, ...mine], send];
}

/** "Yesterday 4:12 PM", "Today 9:05 AM", or a date. */
export function chatTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time}`;
}
