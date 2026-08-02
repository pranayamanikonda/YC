import { useMemo } from "react";
import { rngFrom } from "../lib/seededRandom";

/**
 * Returns a stable factory of deterministic 0..1 generators for a base seed.
 * `rand("petal-2")` always yields the same stream for the same base seed, so a
 * plant never flickers while it stays on screen.
 */
export function useSeededRandom(baseSeed: string): (salt: string) => () => number {
  return useMemo(() => (salt: string) => rngFrom(`${baseSeed}:${salt}`), [baseSeed]);
}
