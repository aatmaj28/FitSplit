import { useEffect, useState } from "react";
import { getMediaJob, type MediaJob } from "./api";

/** A media job, polled every second while it runs. */
export function useMediaJob(id: string | null | undefined) {
  const [job, setJob] = useState<MediaJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setJob(null);
    setError(null);
    if (!id) return;
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const j = await getMediaJob(id);
        if (!alive) return;
        setJob(j);
        setError(null);
        if (j.status === "queued" || j.status === "running") timer = window.setTimeout(tick, 1000);
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
  }, [id]);
  return { job, error };
}

/** Amenities the agent kept, in the job's order. */
export function keptAmenities(job: MediaJob, removed: Set<string>) {
  return job.amenities.filter((a) => !removed.has(a.id));
}
