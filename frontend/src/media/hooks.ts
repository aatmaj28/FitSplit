import { useEffect, useRef, useState } from "react";
import { getMediaJob, type MediaJob } from "./api";

const busy = (j: MediaJob) => j.status === "queued" || j.status === "running" || Object.values(j.engine_status ?? {}).includes("running");

/** A media job, polled every second while it runs (or while another layout engine is being built).
 *  `kick` re-reads it now, e.g. after asking for another engine. */
export function useMediaJob(id: string | null | undefined) {
  const [job, setJob] = useState<MediaJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kicks, setKicks] = useState(0);
  const shown = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (shown.current !== id) {  // a different job: start empty; a kick keeps showing the current one
      shown.current = id;
      setJob(null);
      setError(null);
    }
    if (!id) return;
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const j = await getMediaJob(id);
        if (!alive) return;
        setJob(j);
        setError(null);
        if (busy(j)) timer = window.setTimeout(tick, 1000);
      } catch (e) {
        if (!alive) return;
        setError(String((e as Error).message ?? e));
        timer = window.setTimeout(tick, 3000); // the backend may be busy reading a big video
      }
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, kicks]);
  return { job, error, kick: () => setKicks((k) => k + 1) };
}

/** Amenities the agent kept, in the job's order. */
export function keptAmenities(job: MediaJob, removed: Set<string>) {
  return job.amenities.filter((a) => !removed.has(a.id));
}
