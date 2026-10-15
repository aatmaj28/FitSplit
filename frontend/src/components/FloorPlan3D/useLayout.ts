import { useCallback, useEffect, useState } from "react";
import type { FurnitureItem } from "./furniture";

const PREFIX = "fp3d.layout.v1:";

function load(key: string, initial: FurnitureItem[] = []): FurnitureItem[] {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return initial;
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (i): i is FurnitureItem =>
        i && typeof i.id === "string" && typeof i.name === "string" &&
        [i.w, i.d, i.h, i.x, i.z, i.rot].every((v) => typeof v === "number" && Number.isFinite(v)),
    );
  } catch {
    return initial; // storage blocked (private mode, previews) or corrupt: start over
  }
}

function save(key: string, items: FurnitureItem[]): void {
  try {
    if (items.length) localStorage.setItem(PREFIX + key, JSON.stringify(items));
    else localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable: layout just won't persist */
  }
}

/** Furniture layout for one plan, persisted in localStorage under the plan's key; `initial` is used
 *  until something is saved under that key. */
export function useLayout(key: string, initial?: FurnitureItem[]) {
  const [state, setState] = useState(() => ({ key, items: load(key, initial) }));
  let current = state;
  if (state.key !== key) {
    current = { key, items: load(key, initial) }; // plan changed: switch layouts during render
    setState(current);
  }
  useEffect(() => save(current.key, current.items), [current]);
  const setItems = useCallback(
    (next: FurnitureItem[] | ((prev: FurnitureItem[]) => FurnitureItem[])) =>
      setState((s) => ({ key: s.key, items: typeof next === "function" ? next(s.items) : next })),
    [],
  );
  return [current.items, setItems] as const;
}
