import { lazy, Suspense } from "react";
import type { FloorPlan3DProps } from "./FloorPlan3D";

// three.js + the viewer load on first use, so pages without a 3D view stay light
const Viewer = lazy(() => import("./FloorPlan3D").then((m) => ({ default: m.FloorPlan3D })));

export function FloorPlan3D(props: FloorPlan3DProps) {
  return (
    <Suspense
      fallback={
        <div className={`flex h-full w-full items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-slate-200 ${props.className ?? ""}`}>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" aria-hidden />
            Loading 3D view…
          </div>
        </div>
      }
    >
      <Viewer {...props} />
    </Suspense>
  );
}
