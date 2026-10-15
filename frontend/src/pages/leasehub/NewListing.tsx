import { useEffect, useState } from "react";
import { Link } from "react-router";
import { parseUpload } from "../../api";
import { FloorPlan3D } from "../../components/FloorPlan3D";
import { formatSqft } from "../../components/FloorPlan3D/theme";
import { UploadBox } from "../../components/UploadBox";
import { LISTINGS, listing } from "../../data/listings";
import { getPlan, useOffline } from "../../data/plans";
import { demo, SYNDICATION, useDemo } from "../../data/store";
import type { ParsedPlan } from "../../types";
import { ErrorState } from "../ui";
import { L } from "./LeaseHubLayout";

type Parsed = { plan: ParsedPlan; imageUrl: string; seconds: number; cached: boolean };
const TYPE_ORDER = ["bedroom", "living", "kitchen", "dining", "bathroom", "closet", "balcony", "foyer", "other"];

function autofill(plan: ParsedPlan) {
  const bedrooms = plan.rooms.filter((r) => r.type === "bedroom").length;
  const bathrooms = plan.rooms.filter((r) => r.type === "bathroom").length;
  return {
    beds: plan.unit.beds ?? bedrooms,
    baths: plan.unit.baths ?? bathrooms,
    sqft: plan.unit.total_sqft ?? Math.round(plan.rooms.reduce((s, r) => s + (r.area_sqft_final ?? 0), 0)),
    rent: plan.unit.rent ?? 0,
  };
}

export default function NewListing() {
  const offline = useOffline();
  const { listings } = useDemo();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [busy, setBusy] = useState<{ name: string; started: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", rent: 0, beds: 0, baths: 0, sqft: 0 });
  const [published, setPublished] = useState(0); // syndication targets confirmed so far
  const [publishing, setPublishing] = useState(false);

  const use = (p: Parsed, title?: string) => {
    setParsed(p);
    setPublished(0);
    setPublishing(false);
    setForm({ title: title ?? p.plan.plan_name ?? "New listing", ...autofill(p.plan) });
  };
  const pickSample = async (id: string) => {
    setError(null);
    const t0 = performance.now();
    setBusy({ name: `${id}.png`, started: Date.now() });
    try {
      const r = await getPlan(id);
      use({ ...r, seconds: (performance.now() - t0) / 1000, cached: true }, listing(id)?.title);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };
  const upload = async (file: File) => {
    setError(null);
    const t0 = performance.now();
    setBusy({ name: file.name, started: Date.now() });
    try {
      const r = await parseUpload(file);
      use({ ...r, seconds: (performance.now() - t0) / 1000, cached: Boolean(r.plan.cached) }, listing(r.plan.plan_name)?.title);
    } catch (e) {
      setError(`Couldn't parse ${file.name}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  // syndication: badges tick in one by one after Publish
  useEffect(() => {
    if (!publishing || published >= SYNDICATION.length) return;
    const t = setTimeout(() => setPublished((n) => n + 1), 450);
    return () => clearTimeout(t);
  }, [publishing, published]);
  const publish = () => {
    if (!parsed) return;
    const id = parsed.plan.plan_name ?? `upload_${Date.now()}`;
    const known = listing(id);
    const existing = listings.find((x) => x.id === id);
    demo.publish({
      id, status: "published", publishedAt: new Date().toISOString().slice(0, 10), syndicated: SYNDICATION, views3d: existing?.views3d ?? 0,
      custom: known ? undefined : { title: form.title, rent: form.rent, beds: form.beds, baths: form.baths, sqft: form.sqft, imageUrl: parsed.imageUrl },
    });
    setPublishing(true);
  };
  const done = publishing && published >= SYNDICATION.length;
  const id = parsed?.plan.plan_name;
  const field = "w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">New listing</h1>
        <p className="text-sm text-slate-500">Upload the floor plan once. You get a 3D view and every room's size, and renters get the same when the listing goes out.</p>
      </div>

      {!parsed && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="font-semibold text-slate-900">1. Floor plan</h2>
            <UploadBox onFile={upload} busy={busy} disabled={offline === true} disabledReason="Parsing a new plan needs the backend; pick a sample plan instead" />
            {error && <ErrorState title="Upload failed">{error}</ErrorState>}
            <p className="text-xs text-slate-500">Known plans come back from the cache instantly; a new plan takes 10-30 s (vision model reads labels, OpenCV measures walls and rooms).</p>
          </section>
          <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="font-semibold text-slate-900">Or use a sample floor plan</h2>
            <div className="grid grid-cols-3 gap-2">
              {LISTINGS.map((l) => (
                <button key={l.id} type="button" onClick={() => pickSample(l.id)} disabled={Boolean(busy)} data-sample={l.id}
                  className="rounded-xl bg-white p-2 text-left ring-1 ring-slate-200 transition hover:ring-blue-400 disabled:opacity-50">
                  <img src={l.image} alt="" className="aspect-[4/3] w-full object-contain" />
                  <div className="mt-1 truncate text-xs font-medium text-slate-700">{l.title}</div>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {parsed && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                Parsed in {parsed.seconds < 1 ? "under a second" : `${parsed.seconds.toFixed(1)} s`}{parsed.cached ? " (cached)" : ""}
              </span>
              <span className="text-xs text-slate-500">{parsed.plan.rooms.length} rooms · scale {parsed.plan.scale.pixels_per_foot?.toFixed(1)} px/ft</span>
              <button type="button" onClick={() => setParsed(null)} className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-800">Use another plan</button>
            </div>
            <div className="relative h-[56vh] min-h-[380px]">
              <FloorPlan3D plan={parsed.plan} imageUrl={parsed.imageUrl} />
            </div>
          </section>
          <section className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="font-semibold text-slate-900">2. Details, filled in from the floor plan</h2>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 text-xs font-medium text-slate-600">Title<input className={field} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
              {(["rent", "sqft", "beds", "baths"] as const).map((k) => (
                <label key={k} className="text-xs font-medium text-slate-600">
                  {{ rent: "Rent ($/mo)", sqft: "Total sq ft", beds: "Bedrooms", baths: "Bathrooms" }[k]}
                  <input type="number" step={k === "baths" ? 0.5 : 1} className={field} value={form[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} />
                </label>
              ))}
            </div>
            <div>
              <div className="text-xs font-medium text-slate-600">Room sizes (from the plan)</div>
              <table className="mt-1 w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {[...parsed.plan.rooms].filter((r) => r.type !== "closet").sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)).map((r) => (
                    <tr key={r.id}>
                      <td className="py-1 text-slate-800">{r.name} <span className="text-xs text-slate-400">{r.type}</span></td>
                      <td className="py-1 text-right text-xs text-slate-500">{r.printed_dims_text ?? ""}</td>
                      <td className="py-1 text-right tabular-nums text-slate-800">{formatSqft(r.area_sqft_final)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!publishing ? (
              <button type="button" onClick={publish} disabled={!form.title || form.rent <= 0} className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold ${L.primary} disabled:opacity-50`}>
                3. Publish listing
              </button>
            ) : (
              <div className="space-y-3" aria-live="polite">
                <div className="flex flex-wrap gap-2">
                  {SYNDICATION.map((s, i) => (
                    <span key={s} className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${i < published ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"}`}>
                      {i < published ? `Syndicated to ${s} ✓` : `${s}…`}
                    </span>
                  ))}
                </div>
                {done && (
                  <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
                    Published with its 3D floor plan. Renters see room sizes before they ever call.
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link to={`/leasehub/listings/${id}`} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${L.primary}`}>Open the listing</Link>
                      {listing(id) && <Link to={`/roombae/listings/${id}`} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-300">See it on Roombae</Link>}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-slate-400">Syndication is simulated for the demo.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
