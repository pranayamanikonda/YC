import type { FlowerType, GardenConfig } from "./types";

/** Flower / centre colour pairs — cheerful but bounded. */
export const PALETTE: ReadonlyArray<{ p: string; c: string }> = [
  { p: "#e4483b", c: "#f4c430" },
  { p: "#ec84a6", c: "#fbe3b0" },
  { p: "#f4c430", c: "#e4483b" },
  { p: "#b39ddb", c: "#f4c430" },
  { p: "#8e6bc9", c: "#ec84a6" },
  { p: "#7fb2e8", c: "#f4c430" },
  { p: "#ef7d55", c: "#fbe3b0" },
  { p: "#f7f4ec", c: "#f4c430" },
];

export const FLOWER_TYPES: ReadonlyArray<FlowerType> = ["daisy", "rounded", "cluster", "bud"];

/** Selection green — white text on this is ~4.9:1 (WCAG AA). */
export const SELECTION_GREEN = "#167c3c";

export const DEFAULT_CONFIG: GardenConfig = {
  density: 3,
  spacing: 26,
  growMs: 1,
  reverseMs: 1,
  stemMin: 26,
  stemMax: 74,
  flowerMin: 8,
  flowerMax: 17,
  stagger: 46,
  maxPlants: 64,
  maxButterflies: 4,
  seed: "",
  selColor: SELECTION_GREEN,
  reducedPreview: false,
  showRects: false,
  showOrigins: false,
};
