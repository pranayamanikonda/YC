import type { Variants } from "framer-motion";

/** Cubic-bezier easings for the grow/retract stages. */
export const EASE_GROW: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const EASE_OVERSHOOT: [number, number, number, number] = [0.34, 1.56, 0.64, 1];
export const EASE_OUT: [number, number, number, number] = [0.4, 0, 1, 1];

export type StageTiming = {
  /** grow delay + duration (seconds) */
  dg: number;
  durg: number;
  /** retract delay + duration (seconds) */
  dr: number;
  durr: number;
  easeG?: [number, number, number, number];
  easeR?: [number, number, number, number];
  /** reduced motion → snap instead of animate */
  reduced?: boolean;
};

/**
 * Build a three-label variant set (hidden/grow/retract) from a hidden and a
 * shown target plus a timing. `grow` transitions to `shown`; `retract` returns
 * to `hidden`. Under reduced motion, timings collapse to an instant snap.
 */
export function stage(
  hidden: Record<string, number>,
  shown: Record<string, number>,
  t: StageTiming,
): Variants {
  const durg = t.reduced ? 0.001 : t.durg;
  const durr = t.reduced ? 0.001 : t.durr;
  const dg = t.reduced ? 0 : t.dg;
  const dr = t.reduced ? 0 : t.dr;
  return {
    hidden,
    grow: { ...shown, transition: { delay: dg, duration: durg, ease: t.easeG ?? EASE_GROW } },
    retract: { ...hidden, transition: { delay: dr, duration: durr, ease: t.easeR ?? EASE_OUT } },
  };
}
