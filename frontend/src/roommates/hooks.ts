import { useEffect, useState } from "react";
import { followNegotiation, loadNegotiation, loadProfiles, loadQuestionnaire, loadScenarios, type NegotiationEvent, type NegotiationRecord, type Profile, type QuestionnaireSchema, type Scenarios } from "./api";

function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    fn().then((d) => alive && setData(d), (e) => alive && setError(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [...deps, n]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading: data === null && !error, retry: () => setN((x) => x + 1) };
}

export function useProfiles() {
  const r = useAsync(loadProfiles);
  return { profiles: r.data?.profiles ?? ([] as Profile[]), offline: r.data?.offline ?? true, loading: r.loading, error: r.error, retry: r.retry };
}

export function useScenarios() {
  return useAsync<Scenarios>(loadScenarios);
}

export function useQuestionnaire() {
  return useAsync<QuestionnaireSchema>(loadQuestionnaire);
}

/** Finished negotiation records by id (for scores and verdicts in summaries). */
export function useNegotiationRecords(ids: string[]): Record<string, NegotiationRecord> {
  const [recs, setRecs] = useState<Record<string, NegotiationRecord>>({});
  const key = ids.join(",");
  useEffect(() => {
    let alive = true;
    for (const id of ids) loadNegotiation(id).then((r) => alive && setRecs((m) => ({ ...m, [id]: r })), () => {});
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return recs;
}

/** Events of one negotiation: replayed from storage, or streamed live while it runs. */
export function useNegotiationEvents(id: string | null) {
  const [events, setEvents] = useState<NegotiationEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEvents([]);
    setError(null);
    if (!id) return;
    return followNegotiation(id, (e) => setEvents((prev) => [...prev, e]), setError);
  }, [id]);
  return { events, error };
}
