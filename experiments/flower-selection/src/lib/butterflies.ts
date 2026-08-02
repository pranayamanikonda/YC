import type { ButterflyConfig, GardenConfig, PlantConfig } from "./types";
import { rngFrom } from "./seededRandom";

/** Wing / accent colour pairs. */
const WINGS: ReadonlyArray<{ a: string; b: string }> = [
  { a: "#e4483b", b: "#f4c430" },
  { a: "#7fb2e8", b: "#b39ddb" },
  { a: "#f4c430", b: "#ef7d55" },
  { a: "#ec84a6", b: "#f7f4ec" },
  { a: "#8e6bc9", b: "#7fb2e8" },
];

/**
 * Derive butterflies from the current plants — roughly one per five flowers,
 * capped. Each is keyed to a plant id so it stays stable (no flicker) while that
 * plant is selected, and seeded so the same passage always draws the same
 * butterflies. Departure vectors bias upward and outward for a believable exit.
 */
export function butterfliesFor(plants: PlantConfig[], cfg: GardenConfig): ButterflyConfig[] {
  if (cfg.maxButterflies <= 0 || plants.length === 0) return [];
  const out: ButterflyConfig[] = [];
  const stride = 5;
  for (let i = 0; i < plants.length && out.length < cfg.maxButterflies; i += stride) {
    const p = plants[i];
    const r = rngFrom(`${cfg.seed}:bfly:${p.id}`);
    const w = WINGS[Math.floor(r() * WINGS.length)];
    const ang = r() * Math.PI * 2;
    const dir = r() < 0.5 ? -1 : 1;
    out.push({
      id: `bfly-${p.id}`,
      x: p.x + (r() - 0.5) * 28,
      y: p.y - p.height - p.flowerSize - (12 + r() * 24),
      scale: 0.8 + r() * 0.6,
      color: w.a,
      accent: w.b,
      phase: r() * 3,
      driftX: dir * (70 + r() * 90),
      driftY: -(90 + r() * 130) - Math.abs(Math.sin(ang)) * 40,
      curve: dir * (50 + r() * 90),
    });
  }
  return out;
}
