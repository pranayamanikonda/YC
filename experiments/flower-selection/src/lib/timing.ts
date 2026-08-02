/** Growth/retract stage timings (ms), within the spec's suggested ranges. */
export const TIMING = {
  stem: 260,
  leaf: 170,
  bud: 130,
  petal: 300,
  center: 160,
  leafStep: 44,
  petalStep: 30,
} as const;

/** Grow-stage delays (ms) for one plant, before the growMs multiplier. */
export function growDelays(baseDelay: number, petalCount: number, leafCount: number) {
  const stem = baseDelay;
  const leaves = Array.from({ length: leafCount }, (_, i) => baseDelay + TIMING.stem * 0.5 + i * TIMING.leafStep);
  const bud = baseDelay + TIMING.stem * 0.78;
  const petals = Array.from({ length: petalCount }, (_, i) => bud + TIMING.bud * 0.6 + i * TIMING.petalStep);
  const center = bud + TIMING.bud + petalCount * (TIMING.petalStep - 6);
  return { stem, leaves, bud, petals, center };
}

/** Retract-stage delays (ms) — reverse order — before the reverseMs multiplier. */
export function retractDelays(petalCount: number, leafCount: number) {
  const petals = Array.from({ length: petalCount }, (_, i) => i * 22);
  const center = petalCount * 10;
  const bud = petalCount * 22 + 80;
  const leaves = Array.from({ length: leafCount }, (_, i) => bud + i * 30);
  const stem = bud + 140;
  return { petals, center, bud, leaves, stem };
}
