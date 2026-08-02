import { AnimatePresence } from "framer-motion";
import type { GardenConfig, PlantConfig } from "../lib/types";
import { Plant } from "./Plant";

type Props = { plants: PlantConfig[]; cfg: GardenConfig; reduced: boolean };

/**
 * The botanical layer: an absolutely-positioned, non-interactive SVG that draws
 * the plants in article-relative pixels (1 user unit = 1px, no viewBox). Plants
 * enter via <AnimatePresence> so a removed slot plays its full reverse retract
 * before the node is unmounted — grow, keep, retract are pure list diffing.
 */
export function BotanicalOverlay({ plants, cfg, reduced }: Props) {
  const sorted = [...plants].sort((a, b) => a.depth - b.depth);
  return (
    <svg className="garden-svg garden-botanical" aria-hidden="true" focusable="false">
      <AnimatePresence>
        {sorted.map((p) => (
          <Plant key={p.id} plant={p} cfg={cfg} reduced={reduced} />
        ))}
      </AnimatePresence>
      {cfg.showOrigins &&
        plants.map((p) => <circle key={`o-${p.id}`} cx={p.x} cy={p.y} r={2.5} fill="#ff3b8d" />)}
    </svg>
  );
}
