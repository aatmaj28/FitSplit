import { motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";

const COLORS = ["#e8553e", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6"];

/** A short burst of confetti, played once (nothing when the reader prefers reduced motion). */
export function Confetti({ pieces = 48 }: { pieces?: number }) {
  const reduce = useReducedMotion();
  const bits = useMemo(
    () => Array.from({ length: pieces }, (_, i) => ({
      left: 4 + ((i * 37) % 92), // spread across the width, deterministic
      delay: (i % 12) * 0.06,
      drift: ((i * 53) % 120) - 60,
      spin: ((i * 97) % 540) - 270,
      size: 6 + (i % 4) * 2,
      round: i % 3 === 0,
      color: COLORS[i % COLORS.length],
      duration: 2.2 + (i % 5) * 0.25,
    })),
    [pieces],
  );
  if (reduce) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden" aria-hidden data-confetti>
      {bits.map((b, i) => (
        <motion.span key={i} className="absolute top-0" style={{ left: `${b.left}%`, width: b.size, height: b.round ? b.size : b.size * 0.45, background: b.color, borderRadius: b.round ? 999 : 2 }}
          initial={{ y: -24, x: 0, rotate: 0, opacity: 1 }}
          animate={{ y: "105vh", x: b.drift, rotate: b.spin, opacity: [1, 1, 0.9, 0] }}
          transition={{ duration: b.duration, delay: b.delay, ease: [0.25, 0.6, 0.5, 1] }} />
      ))}
    </div>
  );
}
