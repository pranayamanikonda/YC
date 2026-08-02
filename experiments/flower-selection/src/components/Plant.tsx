import { motion } from "framer-motion";
import type { Variants } from "framer-motion";
import type { GardenConfig, PlantConfig } from "../lib/types";
import { growDelays, retractDelays, TIMING } from "../lib/timing";
import { Stem } from "./Stem";
import { Leaf } from "./Leaf";
import { FlowerHead } from "./FlowerHead";

type Props = { plant: PlantConfig; cfg: GardenConfig; reduced: boolean };

/** Container variants — labels propagate to children; no transform of its own. */
const ROOT: Variants = { hidden: {}, grow: {}, retract: {} };

const STEM_STROKE = "#3f7d3a";
const LEAF_FILL = "#5aa64f";
const LEAF_STROKE = "#2f5f2c";
const OUTLINE = "#2a2a2a";

/**
 * One plant: stem → leaves → flower head, staged out of a single origin.
 * Geometry is a curved quadratic; leaves attach at sampled points along it.
 * All stage timings come from `timing.ts`, converted to seconds and offset by
 * this plant's cross-plant stagger (`order * stagger`).
 */
export function Plant({ plant, cfg, reduced }: Props) {
  const { x, y, height, bend, stemCurve, rotation, leaves, flowerType, petalCount, flowerSize } = plant;

  // Quadratic stem: base (0,0) → control → tip.
  const cx = bend * 0.5 + stemCurve * 16;
  const cy = -height * 0.55;
  const tipX = bend;
  const tipY = -height;
  const stemD = `M0 0 Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${tipX.toFixed(2)} ${tipY.toFixed(2)}`;

  const quad = (t: number) => {
    const u = 1 - t;
    return {
      x: 2 * u * t * cx + t * t * tipX,
      y: 2 * u * t * cy + t * t * tipY,
      ang: (Math.atan2(2 * u * cy + 2 * t * (tipY - cy), 2 * u * cx + 2 * t * (tipX - cx)) * 180) / Math.PI,
    };
  };

  const ms = 1000;
  const g = growDelays(plant.order * cfg.stagger, petalCount, leaves.length);
  const r = retractDelays(petalCount, leaves.length);
  const gs = (v: number) => (v / ms) * cfg.growMs;
  const rs = (v: number) => (v / ms) * cfg.reverseMs;

  const stemW = Math.max(1.4, height * 0.045);

  return (
    <g data-plant transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rotation.toFixed(2)})`}>
      <motion.g variants={ROOT} initial="hidden" animate="grow" exit="retract">
        <Stem
          d={stemD}
          color={STEM_STROKE}
          width={stemW}
          delayGrow={gs(g.stem)}
          durGrow={gs(TIMING.stem)}
          delayRetract={rs(r.stem)}
          durRetract={rs(TIMING.stem * 0.8)}
          reduced={reduced}
        />

        {leaves.map((leaf, i) => {
          const pt = quad(leaf.at);
          const angle = pt.ang + leaf.side * 62;
          const len = 8 + leaf.scale * 9;
          return (
            <Leaf
              key={i}
              x={pt.x}
              y={pt.y}
              angle={angle}
              length={len}
              width={len * 0.42}
              color={LEAF_FILL}
              stroke={LEAF_STROKE}
              delayGrow={gs(g.leaves[i] ?? g.stem)}
              durGrow={gs(TIMING.leaf)}
              delayRetract={rs(r.leaves[i] ?? r.stem)}
              durRetract={rs(TIMING.leaf * 0.75)}
              reduced={reduced}
            />
          );
        })}

        <FlowerHead
          type={flowerType}
          x={tipX}
          y={tipY}
          size={flowerSize}
          petalCount={petalCount}
          color={plant.flowerColor}
          centerColor={plant.centerColor}
          stroke={OUTLINE}
          spin={plant.wobble * 18}
          budDelay={gs(g.bud)}
          petalDelays={g.petals.map(gs)}
          centerDelay={gs(g.center)}
          budRetract={rs(r.bud)}
          petalRetracts={r.petals.map(rs)}
          centerRetract={rs(r.center)}
          reduced={reduced}
        />
      </motion.g>
    </g>
  );
}
