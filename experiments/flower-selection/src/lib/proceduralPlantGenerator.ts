import type { GardenConfig, GardenRange, LeafConfig, PlantConfig } from "./types";
import { rngFrom } from "./seededRandom";
import { PALETTE, FLOWER_TYPES } from "./palette";
import { buildCharMaps, charRect, type CharMap } from "./selectionToCharIndex";

/** A plant slot: a stable id + origin, keyed by character bucket. */
export type Slot = { id: string; seed: string; x: number; y: number; order: number };

/**
 * Turn a garden selection into plant slots. Density places ~one slot per N
 * characters; slot ids are bucketed by character index so a slot stays stable
 * while the same characters remain selected. Collision-aware spacing prevents
 * flowers from fully overlapping.
 */
export function slotsFor(
  stage: HTMLElement,
  selection: GardenRange[],
  maps: Map<HTMLElement, CharMap>,
  cfg: GardenConfig,
  paragraphs: HTMLElement[],
): Slot[] {
  const slots: Slot[] = [];
  const stride = Math.max(1, Math.round(cfg.density));
  const placedX: number[] = [];
  let count = 0;
  for (const { paragraph, start, end } of selection) {
    const pIdx = paragraphs.indexOf(paragraph);
    const map = maps.get(paragraph);
    if (!map) continue;
    const first = Math.ceil(start / stride) * stride;
    for (let c = first; c < end && count < cfg.maxPlants; c += stride) {
      const rect = charRect(stage, map, c);
      if (!rect) continue;
      if (placedX.some((px) => Math.abs(px - rect.cx) < cfg.spacing)) continue;
      placedX.push(rect.cx);
      const id = `g${pIdx}-${c}`;
      slots.push({ id, seed: `${cfg.seed}:${id}`, x: rect.cx, y: rect.bottom, order: count });
      count++;
    }
  }
  return slots;
}

/** Deterministically expand a slot into a full plant config. */
export function plantConfig(slot: Slot, cfg: GardenConfig): PlantConfig {
  const r = rngFrom(slot.seed);
  const flowerType = FLOWER_TYPES[Math.floor(r() * FLOWER_TYPES.length)];
  const pal = PALETTE[Math.floor(r() * PALETTE.length)];
  const height = cfg.stemMin + r() * (cfg.stemMax - cfg.stemMin);
  const leafCount = flowerType === "bud" ? 1 : 1 + Math.floor(r() * 3);
  const leaves: LeafConfig[] = [];
  for (let i = 0; i < leafCount; i++) {
    leaves.push({
      at: 0.32 + (i / Math.max(1, leafCount)) * 0.5 + r() * 0.06,
      side: i % 2 === 0 ? 1 : -1,
      scale: 0.7 + r() * 0.6,
    });
  }
  return {
    id: slot.id,
    seed: slot.seed,
    x: slot.x,
    y: slot.y,
    height,
    bend: (r() - 0.5) * height * 0.5,
    rotation: (r() - 0.5) * 24,
    stemCurve: (r() - 0.5) * 0.6,
    flowerType,
    petalCount: flowerType === "daisy" ? 8 + Math.floor(r() * 5) : 5,
    flowerSize: (flowerType === "bud" ? cfg.flowerMin * 0.7 : cfg.flowerMin) + r() * (cfg.flowerMax - cfg.flowerMin),
    flowerColor: pal.p,
    centerColor: pal.c,
    leaves,
    order: slot.order,
    depth: r(),
    wobble: r() - 0.5,
  };
}

export { buildCharMaps };
