import { motion } from "framer-motion";
import { EASE_OVERSHOOT, EASE_OUT, stage } from "../lib/anim";

type Props = {
  /** attach point along the stem, article-local */
  x: number;
  y: number;
  /** rotation of the leaf (degrees), already biased to its side */
  angle: number;
  length: number;
  width: number;
  color: string;
  stroke: string;
  delayGrow: number;
  durGrow: number;
  delayRetract: number;
  durRetract: number;
  reduced: boolean;
};

/**
 * A single leaf. Positioning + rotation live on a plain <g> attribute wrapper;
 * the growth scale animates on the inner element from the attach point
 * (`transform-box: fill-box`, origin at the leaf base), so the SVG position and
 * the animated scale never fight over the same transform.
 */
export function Leaf({
  x, y, angle, length, width, color, stroke,
  delayGrow, durGrow, delayRetract, durRetract, reduced,
}: Props) {
  const w = width;
  const l = length;
  const d = `M0 0 C ${l * 0.22} ${-w}, ${l * 0.8} ${-w * 0.6}, ${l} 0 C ${l * 0.8} ${w * 0.6}, ${l * 0.22} ${w}, 0 0 Z`;
  const midrib = `M0 0 L ${l} 0`;
  const variants = stage(
    { scale: 0, opacity: 0 },
    { scale: 1, opacity: 1 },
    { dg: delayGrow, durg: durGrow, dr: delayRetract, durr: durRetract, easeG: EASE_OVERSHOOT, easeR: EASE_OUT, reduced },
  );
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <motion.g
        variants={variants}
        style={{ transformBox: "fill-box", transformOrigin: "0% 50%" }}
      >
        <path d={d} fill={color} stroke={stroke} strokeWidth={0.75} strokeLinejoin="round" />
        <path d={midrib} fill="none" stroke={stroke} strokeWidth={0.5} opacity={0.5} />
      </motion.g>
    </g>
  );
}
