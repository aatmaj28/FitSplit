import { useEffect, useMemo, useState } from "react";
import { computeSplit, type SplitMethod, type SplitResult } from "../rentSplit";
import type { ParsedPlan } from "../types";

export interface RentSplitProps {
  plan: ParsedPlan;
  /** Highlight a bedroom (shared with <FloorPlan3D selectedRoomId>). */
  selectedRoomId?: string | null;
  onSelectRoom?: (id: string | null) => void;
  className?: string;
}

const money = (v: number) => `$${Math.round(v).toLocaleString()}`;
const sqft = (v: number) => `${Math.round(v).toLocaleString()} sq ft`;
const NAMES = "rentsplit.names.v1:";

function useRoommateNames(key: string) {
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(NAMES + key) ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  };
  const [names, setNames] = useState<Record<string, string>>(read);
  useEffect(() => setNames(read()), [key]);
  const set = (roomId: string, name: string) =>
    setNames((prev) => {
      const next = { ...prev, [roomId]: name };
      try {
        localStorage.setItem(NAMES + key, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  return [names, set] as const;
}

function explain(s: SplitResult, method: SplitMethod, closets: boolean): string {
  const n = s.rows.length;
  const areas = s.rows.map((r) => Math.round(r.weight)).join(" / ");
  const what = closets ? "bedrooms (with their closets)" : "bedrooms";
  if (method === "size") {
    return `The whole ${money(s.rent)} is divided in proportion to bedroom size (${areas} sq ft). Shared space is ignored, so the size gap between rooms counts for the full rent.`;
  }
  const bath = s.rows.some((r) => r.privateBath) ? " A private bathroom counts as part of its bedroom." : "";
  return (
    `Everyone pays for their own room and splits the rest. The ${what} cover ${Math.round(s.privateFraction * 100)}% of the ` +
    `${sqft(s.totalSqft ?? 0)} unit, so ${Math.round(s.privateFraction * 100)}% of the rent (${money(s.privatePortion)}) is divided by room size.` +
    `${bath} The other ${money(s.sharedPortion)} covers shared space (living room, kitchen, halls, shared baths) and is split ${n} ways, ` +
    `${money(s.sharedEach)} each. Shares are rounded to whole dollars and always add up to the rent.`
  );
}

/** Fair rent split by bedroom size, with a private bath counted toward its bedroom. */
export function RentSplit({ plan, selectedRoomId = null, onSelectRoom, className = "" }: RentSplitProps) {
  const key = plan.plan_name ?? plan.source_image;
  const [method, setMethod] = useState<SplitMethod>("fair");
  const [closets, setClosets] = useState(false);
  const [rent, setRent] = useState<number>(plan.unit.rent ?? 0);
  const [names, setName] = useRoommateNames(key);
  useEffect(() => setRent(plan.unit.rent ?? 0), [plan]);

  const split = useMemo(() => computeSplit(plan, { method, includeClosets: closets, rent }), [plan, method, closets, rent]);
  const total = split.rows.reduce((s, r) => s + r.share, 0);
  const n = split.rows.length;

  return (
    <section className={`flex flex-col gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200 ${className}`} aria-label="Rent split">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Rent split</h2>
          <p className="text-xs text-slate-500">
            {n} bedroom{n === 1 ? "" : "s"}
            {plan.unit.total_sqft ? ` · ${sqft(plan.unit.total_sqft)}` : ""}
          </p>
        </div>
        <label className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-2.5 py-1.5 text-sm ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-teal-500">
          <span className="text-slate-400">$</span>
          <input
            inputMode="numeric"
            value={rent ? rent.toString() : ""}
            onChange={(e) => setRent(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
            placeholder="Rent"
            aria-label="Monthly rent"
            className="w-16 border-0 bg-transparent p-0 text-right font-semibold tabular-nums text-slate-800 focus:outline-none"
          />
          <span className="text-xs text-slate-400">/mo</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-xs" role="group" aria-label="Split method">
          {(
            [
              ["fair", "Fair split"],
              ["size", "By room size only"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              aria-pressed={method === m}
              className={`rounded-full px-3 py-1 font-medium transition-colors ${method === m ? "bg-teal-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600">
          <span className="relative inline-flex h-4 w-7 items-center">
            <input type="checkbox" checked={closets} onChange={(e) => setClosets(e.target.checked)} className="peer sr-only" />
            <span className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-teal-600" />
            <span className="absolute left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform peer-checked:translate-x-3" />
          </span>
          Include attached closets
        </label>
      </div>

      {!rent ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Enter the monthly rent to see the split.</p>
      ) : n === 0 ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">No bedrooms with an area on this plan.</p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {split.rows.map((r, i) => {
            const selected = r.room.id === selectedRoomId;
            const toggle = () => onSelectRoom?.(selected ? null : r.room.id);
            return (
              <div
                key={r.room.id}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                onClick={toggle}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    toggle();
                  }
                }}
                data-room={r.room.id}
                className={`cursor-pointer rounded-2xl p-3.5 text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
                  selected ? "bg-teal-50/60 ring-2 ring-teal-500" : "bg-white ring-1 ring-slate-200 hover:ring-slate-300"
                }`}
              >
                <div className="truncate text-sm font-semibold text-slate-900">
                  {r.room.name}
                  <span className="ml-1.5 text-xs font-normal text-slate-400">Bedroom {i + 1}</span>
                </div>
                <div className="truncate text-xs text-slate-500">
                  {r.room.printed_dims_text ? `${r.room.printed_dims_text} · ` : ""}
                  {sqft(r.bedroomArea)}
                </div>
                <div className="mt-1.5 flex min-h-5 flex-wrap gap-1">
                  {r.room.has_private_bath && (
                    <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-800">
                      Private bath{r.privateBath && method === "fair" ? ` +${Math.round(r.privateBathArea)} sq ft` : ""}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
                  <div className="text-2xl font-semibold tabular-nums text-slate-900">
                    {money(r.share)}
                    <span className="text-sm font-normal text-slate-400">/mo</span>
                  </div>
                  <span
                    className={`mb-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                      r.vsEven > 0 ? "bg-amber-50 text-amber-800" : r.vsEven < 0 ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {r.vsEven === 0 ? "same as even" : `${r.vsEven > 0 ? "+" : "−"}${money(Math.abs(r.vsEven))} vs even`}
                  </span>
                </div>
                <input
                  value={names[r.room.id] ?? ""}
                  onChange={(e) => setName(r.room.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="Roommate name"
                  aria-label={`Roommate in ${r.room.name} (bedroom ${i + 1})`}
                  className="mt-2 w-full rounded-lg border-0 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 ring-1 ring-slate-200 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
              </div>
            );
          })}
        </div>
      )}

      {rent > 0 && n > 0 && (
        <>
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span>
              Even split would be {money(rent / n)} each
            </span>
            <span className={`font-semibold tabular-nums ${total === Math.round(rent) ? "text-teal-700" : "text-red-700"}`}>
              Total {money(total)} {total === Math.round(rent) ? "= rent ✓" : "≠ rent"}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">{explain(split, method, closets)}</p>
          {split.notes.map((note) => (
            <p key={note} className="text-xs text-amber-700">
              {note}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
