export type FlowerType = "daisy" | "rounded" | "cluster" | "bud";

/** A single generated plant. Everything a <Plant> needs to render + animate. */
export type PlantConfig = {
  id: string;
  seed: string;
  /** origin in article-relative px (lower edge of the selected character) */
  x: number;
  y: number;
  height: number;
  /** horizontal offset of the stem tip (a lean) */
  bend: number;
  rotation: number;
  stemCurve: number;
  flowerType: FlowerType;
  petalCount: number;
  flowerSize: number;
  flowerColor: string;
  centerColor: string;
  leaves: LeafConfig[];
  /** growth stagger index (order the plant appeared in) */
  order: number;
  depth: number;
  wobble: number;
};

export type LeafConfig = {
  /** 0..1 position along the stem */
  at: number;
  side: 1 | -1;
  scale: number;
};

/** A selected character range within one interactive paragraph. */
export type GardenRange = { paragraph: HTMLElement; start: number; end: number };

/** A rectangle for the selection highlight, article-relative px. */
export type HighlightRect = { left: number; top: number; width: number; height: number };

/** Tunable knobs, surfaced by the debug panel. */
export type GardenConfig = {
  density: number;
  spacing: number;
  growMs: number;
  reverseMs: number;
  stemMin: number;
  stemMax: number;
  flowerMin: number;
  flowerMax: number;
  stagger: number;
  maxPlants: number;
  seed: string;
  selColor: string;
  reducedPreview: boolean;
  showRects: boolean;
  showOrigins: boolean;
};
