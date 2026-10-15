import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { PRODUCT } from "../brand";
import { loadPlan, loadPlanList, parseUpload, thumbnailUrl, type PlanSource } from "../api";
import { FloorPlan3D, type ViewMode } from "../components/FloorPlan3D";
import { formatSqft } from "../components/FloorPlan3D/theme";
import { RentSplit } from "../components/RentSplit";
import { UploadBox } from "../components/UploadBox";
import type { ParsedPlan } from "../types";

const DEFAULT_PLAN = "jvue_3bed";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-800">{value}</div>
    </div>
  );
}

/** Parser lab: every parsed plan, uploads, the 3D viewer and the rent split side by side. */
export default function DevParser() {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [source, setSource] = useState<PlanSource | null>(null);
  const [selected, setSelected] = useState(params.get("plan") ?? "");
  const [current, setCurrent] = useState<{ plan: ParsedPlan; imageUrl: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [upload, setUpload] = useState<{ name: string; started: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null); // shared by the 3D view and the rent split

  const refreshList = useCallback(async () => {
    const s = await loadPlanList();
    setSource(s);
    return s;
  }, []);

  useEffect(() => {
    refreshList()
      .then((s) => {
        setSelected((sel) => sel || (s.plans.some((p) => p.name === DEFAULT_PLAN) ? DEFAULT_PLAN : (s.plans[0]?.name ?? "")));
      })
      .catch((e) => setError(`Could not load plans: ${e.message}`))
      .finally(() => setLoading(false));
  }, [refreshList]);

  const loaded = useRef<string | null>(null); // plan currently shown (uploads set it directly)
  useEffect(() => {
    if (!source || !selected || loaded.current === selected) return;
    let alive = true;
    setLoading(true);
    setError(null);
    loadPlan(selected, source.offline)
      .then((r) => {
        if (!alive) return;
        loaded.current = selected;
        setCurrent(r);
        setRoomId(null);
      })
      .catch((e) => alive && setError(`Could not load ${selected}: ${e.message}`))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source, selected]);

  const onUpload = async (file: File) => {
    setUpload({ name: file.name, started: Date.now() });
    setError(null);
    try {
      const r = await parseUpload(file);
      loaded.current = r.plan.plan_name ?? null;
      setCurrent(r);
      setRoomId(null);
      setSelected(r.plan.plan_name ?? "");
      await refreshList();
    } catch (e) {
      setError(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUpload(null);
    }
  };

  const offline = source?.offline ?? false;
  const plan = current?.plan;
  const thumb = source?.plans.find((p) => p.name === selected);

  return (
    <div className="min-h-full">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-teal-600 text-white shadow-sm">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                <path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <div className="text-xs font-medium text-teal-700">{PRODUCT} parser lab</div>
              <h1 className="text-base font-semibold leading-tight text-slate-900 sm:text-lg">Floor plan to 3D</h1>
            </div>
          </Link>
          {offline && (
            <span
              className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200"
              title="Showing saved plans"
            >
              Saved plans
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-4">
        <section className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <label className="flex items-center gap-3 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
            {thumb && source && (
              <img src={thumbnailUrl(thumb, offline)} alt="" className="h-10 w-10 shrink-0 rounded-md object-contain ring-1 ring-slate-200" />
            )}
            <span className="shrink-0 text-sm text-slate-500">Plan</span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!source || Boolean(upload)}
              className="w-full min-w-0 rounded-lg border-0 bg-slate-50 px-2 py-1.5 text-sm font-medium text-slate-800 ring-1 ring-slate-200 focus:ring-2 focus:ring-teal-500 focus:outline-none"
            >
              {!source && <option>Loading…</option>}
              {source?.plans.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.unit?.beds != null ? ` · ${p.unit.beds} bd / ${p.unit.baths} ba` : ""}
                </option>
              ))}
            </select>
          </label>
          <UploadBox
            onFile={onUpload}
            busy={upload}
            disabled={offline}
            disabledReason="Uploads are unavailable right now (saved plans still work)"
          />
        </section>

        {error && <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-red-200">{error}</div>}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="relative h-[74vh] min-h-[460px] sm:h-[70vh] sm:min-h-[480px]">
            {plan ? (
              <FloorPlan3D
                key={plan.plan_name ?? plan.source_image}
                plan={plan}
                imageUrl={current?.imageUrl}
                initialView={(params.get("view") as ViewMode) ?? "3d"}
                initialShow2D={params.get("overlay") === "1"}
                editable
                selectedRoomId={roomId}
                onRoomSelect={(r) => setRoomId(r?.id ?? null)}
              />
            ) : (
              <div className="grid h-full place-items-center rounded-2xl bg-white text-sm text-slate-400 ring-1 ring-slate-200">
                {loading ? "Loading plan…" : "Pick a plan or upload one"}
              </div>
            )}
            {loading && plan && (
              <div className="absolute right-3 bottom-3 z-50 rounded-full bg-white/90 px-3 py-1 text-xs text-slate-500 ring-1 ring-slate-200">
                Loading…
              </div>
            )}
          </div>
          {plan && <RentSplit key={plan.plan_name ?? plan.source_image} plan={plan} selectedRoomId={roomId} onSelectRoom={setRoomId} />}
        </div>

        {plan && (
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Fact label="Beds / baths" value={`${plan.unit.beds ?? "-"} / ${plan.unit.baths ?? "-"}`} />
            <Fact label="Total" value={formatSqft(plan.unit.total_sqft)} />
            <Fact label="Rent" value={plan.unit.rent != null ? `$${plan.unit.rent.toLocaleString()}/mo` : "-"} />
            <Fact label="Rooms" value={plan.rooms.length} />
            <Fact
              label="Scale"
              value={plan.scale.pixels_per_foot ? `${plan.scale.pixels_per_foot.toFixed(1)} px/ft (${plan.scale.method})` : "none"}
            />
            <Fact label="Read by" value={plan.semantics_provider} />
          </section>
        )}
        {plan && plan.warnings.length > 0 && (
          <details className="rounded-xl bg-white px-4 py-2.5 text-sm ring-1 ring-slate-200">
            <summary className="cursor-pointer text-slate-600">
              {plan.warnings.length} parser warning{plan.warnings.length > 1 ? "s" : ""}
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
              {plan.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </main>
    </div>
  );
}
