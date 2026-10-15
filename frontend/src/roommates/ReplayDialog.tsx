import { useEffect, useRef } from "react";
import { PageLoading, ErrorState } from "../pages/ui";
import type { Profile } from "./api";
import { useNegotiationEvents } from "./hooks";
import { Avatar, NegotiationView } from "./NegotiationView";
import { firstName } from "./people";

/** The clones' conversation of one pair, replayed from the start in a dialog. */
export function ReplayDialog({ id, a, b, onClose }: { id: string; a: Profile; b: Profile; onClose: () => void }) {
  const { events, error } = useNegotiationEvents(id);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtn.current?.focus();
    // capture phase: Escape closes only this dialog, not the screen underneath
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${firstName(a)} and ${firstName(b)}: the clones' conversation`} data-replay-dialog={id}
        className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-[#fbfaff] p-4 shadow-2xl sm:rounded-3xl sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <Avatar id={a.id} name={a.name} color={a.color} />
          <span className="font-medium text-slate-800">{firstName(a)}'s clone</span>
          <span className="text-slate-400">and</span>
          <Avatar id={b.id} name={b.name} color={b.color} />
          <span className="font-medium text-slate-800">{firstName(b)}'s clone</span>
          <button ref={closeBtn} type="button" onClick={onClose} className="ml-auto rounded-full px-2.5 py-1 text-slate-500 ring-1 ring-slate-200 hover:text-slate-900" aria-label="Close">✕</button>
        </div>
        {error ? (
          <ErrorState title="Can't show this conversation">{error}</ErrorState>
        ) : events.length ? (
          <NegotiationView events={events} a={{ name: a.name, color: a.color, id: a.id }} b={{ name: b.name, color: b.color, id: b.id }} />
        ) : (
          <PageLoading label="Loading the conversation…" />
        )}
      </div>
    </div>
  );
}
