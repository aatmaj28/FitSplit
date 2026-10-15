import { useState } from "react";
import { LIBRARY, type FitResult, type FurnitureItem, type FurnitureKind } from "./furniture";
import { formatSqft } from "./theme";

const btn = "rounded-lg px-2 py-1 text-xs font-medium ring-1 ring-slate-200 transition-colors hover:bg-teal-50 hover:text-teal-800 hover:ring-teal-200";

/** Furniture section of the room panel while editing the layout. */
export function FurniturePanel({ items, fits, describe, freeSqft, totalSqft, selectedItemId, onSelectItem, onAdd, onRotate, onDelete, onAutoPlace, autoMessage }: {
  items: FurnitureItem[];
  fits: Map<string, FitResult>;
  describe: (it: FurnitureItem) => string;
  freeSqft: number;
  totalSqft: number;
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
  onAdd: (kind: FurnitureKind) => void;
  onRotate: (id: string) => void;
  onDelete: (id: string) => void;
  onAutoPlace: (kinds: FurnitureKind[]) => void;
  autoMessage: string | null;
}) {
  const [custom, setCustom] = useState({ name: "", w: "", d: "", h: "" });
  const [want, setWant] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<"add" | "auto">("add");
  const customKind = (): FurnitureKind | null => {
    const w = Number(custom.w), d = Number(custom.d), h = Number(custom.h);
    if (!custom.name.trim() || !(w > 0 && d > 0 && h > 0) || w > 400 || d > 400 || h > 200) return null;
    return { kind: "custom", name: custom.name.trim(), w, d, h, color: "#9fc9c4" };
  };
  const wanted = LIBRARY.flatMap((k) => Array.from({ length: want[k.kind] ?? 0 }, () => k));
  const usedPct = totalSqft > 0 ? Math.min(100, ((totalSqft - freeSqft) / totalSqft) * 100) : 0;

  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Furniture</span>
          <span className="text-xs text-slate-500">
            Free floor <span className="font-semibold text-slate-800">{formatSqft(freeSqft)}</span> of {formatSqft(totalSqft)}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-teal-500" style={{ width: `${usedPct}%` }} />
        </div>
        {items.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">Nothing here yet. Add a piece below, then drag it on the floor.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {items.map((it) => {
              const fit = fits.get(it.id);
              const ok = fit?.ok ?? true;
              const inTheWay = ok && Boolean(fit?.blocks.length);
              const sel = it.id === selectedItemId;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => onSelectItem(it.id)}
                    className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${sel ? "bg-slate-100" : "hover:bg-slate-50"}`}
                  >
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${!ok ? "bg-red-500" : inTheWay ? "bg-amber-500" : "bg-green-500"}`} />
                    <span className={!ok ? "text-red-700" : inTheWay ? "text-amber-800" : "text-slate-700"}>{describe(it)}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-slate-400">
                      {it.w}×{it.d}"
                    </span>
                  </button>
                  {sel && (
                    <div className="mt-1 flex gap-1.5 pl-6">
                      <button type="button" className={btn} onClick={() => onRotate(it.id)}>
                        Rotate 90° <kbd className="text-slate-400">R</kbd>
                      </button>
                      <button type="button" className={`${btn} hover:bg-red-50! hover:text-red-700! hover:ring-red-200!`} onClick={() => onDelete(it.id)}>
                        Delete <kbd className="text-slate-400">Del</kbd>
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-xs">
        {(["add", "auto"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-full px-2.5 py-1 font-medium ${mode === m ? "bg-white text-teal-700 shadow-sm" : "text-slate-500"}`}
          >
            {m === "add" ? "Add furniture" : "Will my stuff fit?"}
          </button>
        ))}
      </div>

      {mode === "add" ? (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {LIBRARY.map((k) => (
              <button
                key={k.kind}
                type="button"
                onClick={() => onAdd(k)}
                title={`${k.name} ${k.w}×${k.d}×${k.h}"`}
                className={`${btn} flex items-center gap-1.5 text-left`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: k.color }} />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate">{k.name}</span>
                  <span className="block text-[10px] font-normal text-slate-400">
                    {k.w}×{k.d}"
                  </span>
                </span>
              </button>
            ))}
          </div>
          <form
            className="space-y-1.5 rounded-lg bg-slate-50 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              const k = customKind();
              if (k) {
                onAdd(k);
                setCustom({ name: "", w: "", d: "", h: "" });
              }
            }}
          >
            <div className="text-xs font-medium text-slate-600">Custom item (inches)</div>
            <input
              value={custom.name}
              onChange={(e) => setCustom({ ...custom, name: e.target.value })}
              placeholder="Name, e.g. Piano"
              className="w-full rounded-md border-0 bg-white px-2 py-1 text-xs ring-1 ring-slate-200 focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
            <div className="flex gap-1.5">
              {(["w", "d", "h"] as const).map((f) => (
                <input
                  key={f}
                  inputMode="decimal"
                  value={custom[f]}
                  onChange={(e) => setCustom({ ...custom, [f]: e.target.value.replace(/[^0-9.]/g, "") })}
                  placeholder={f === "w" ? "W" : f === "d" ? "D" : "H"}
                  aria-label={f === "w" ? "Width (in)" : f === "d" ? "Depth (in)" : "Height (in)"}
                  className="w-full min-w-0 rounded-md border-0 bg-white px-2 py-1 text-xs ring-1 ring-slate-200 focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
              ))}
              <button type="submit" disabled={!customKind()} className="rounded-md bg-teal-600 px-2.5 text-xs font-medium text-white disabled:opacity-40">
                Add
              </button>
            </div>
          </form>
        </>
      ) : (
        <div className="space-y-2">
          <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
            {LIBRARY.map((k) => (
              <div key={k.kind} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: k.color }} />
                <span className="text-slate-700">{k.name}</span>
                <span className="text-[10px] text-slate-400">
                  {k.w}×{k.d}"
                </span>
                <span className="ml-auto inline-flex items-center gap-1">
                  <button type="button" className={`${btn} px-1.5! py-0!`} onClick={() => setWant({ ...want, [k.kind]: Math.max(0, (want[k.kind] ?? 0) - 1) })} aria-label={`Fewer ${k.name}`}>
                    −
                  </button>
                  <span className="w-4 text-center tabular-nums">{want[k.kind] ?? 0}</span>
                  <button type="button" className={`${btn} px-1.5! py-0!`} onClick={() => setWant({ ...want, [k.kind]: Math.min(6, (want[k.kind] ?? 0) + 1) })} aria-label={`More ${k.name}`}>
                    +
                  </button>
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={!wanted.length}
            onClick={() => onAutoPlace(wanted)}
            className="w-full rounded-lg bg-teal-600 py-1.5 text-xs font-medium text-white shadow-sm disabled:opacity-40"
          >
            Place {wanted.length || ""} along the walls
          </button>
        </div>
      )}
      {autoMessage && <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600">{autoMessage}</p>}
      <p className="text-[11px] text-slate-400">Drag pieces on the floor (3" snap) · R rotate · Del delete · arrows nudge</p>
    </div>
  );
}
