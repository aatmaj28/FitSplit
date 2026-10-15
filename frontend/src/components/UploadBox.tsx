import { useEffect, useRef, useState } from "react";

/** Drop zone / file picker for POST /api/parse, with an elapsed-time loading state. */
export function UploadBox({ onFile, busy, disabled, disabledReason }: {
  onFile: (file: File) => void;
  busy: { name: string; started: number } | null;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [busy]);

  const off = disabled || Boolean(busy);
  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f && !off) onFile(f);
  };

  return (
    <div
      role="button"
      tabIndex={off ? -1 : 0}
      aria-disabled={off}
      onClick={() => !off && input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !off && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!off) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pick(e.dataTransfer.files);
      }}
      title={disabled ? disabledReason : undefined}
      className={`flex min-h-[56px] items-center gap-3 rounded-xl border-2 border-dashed px-4 py-2.5 text-sm transition-colors ${
        off ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400" : "cursor-pointer border-slate-300 bg-white text-slate-600 hover:border-teal-500 hover:text-teal-700"
      } ${over ? "border-teal-500 bg-teal-50" : ""}`}
    >
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files)} />
      {busy ? (
        <>
          <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" aria-hidden />
          <span>
            Reading <span className="font-medium text-slate-800">{busy.name}</span> with AI…{" "}
            <span className="tabular-nums">{Math.floor((now - busy.started) / 1000)}s</span>
            <span className="block text-xs text-slate-400">The vision call usually takes 5–20 s.</span>
          </span>
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{disabled ? (disabledReason ?? "Upload unavailable") : "Upload a floor plan (PNG / JPG), or drop it here"}</span>
        </>
      )}
    </div>
  );
}
