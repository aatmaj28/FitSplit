/** The three renters of the story (same ids and colors as the app's roommate profiles). */
export const CAST = [
  { id: "priya", name: "Priya", color: "#0d9488" },
  { id: "ananya", name: "Ananya", color: "#7c3aed" },
  { id: "meera", name: "Meera", color: "#db2777" },
] as const;

/** A pale version of a color (the mix the app uses behind avatars). */
export function tint(hex: string, amount = 0.8): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

/** An illustrated avatar on a pale circle of the person's color. */
export function Face({ id, color, className = "h-9 w-9" }: { id: string; color: string; className?: string }) {
  return (
    <span className={`block shrink-0 overflow-hidden rounded-full ${className}`} style={{ background: tint(color) }}>
      <img src={`/demo/avatars/${id}.svg`} alt="" draggable={false} className="h-full w-full scale-[1.18] object-cover" style={{ transformOrigin: "50% 30%" }} />
    </span>
  );
}

/** The three renters, overlapping. */
export function Faces({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span className="flex shrink-0 -space-x-2.5" aria-hidden>
      {CAST.map((p) => <Face key={p.id} id={p.id} color={p.color} className={`${className} ring-2 ring-white`} />)}
    </span>
  );
}
