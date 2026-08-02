import { motion } from "framer-motion";
import { EASE_GROW, EASE_OUT, stage } from "../lib/anim";

type Props = {
  /** stem path, drawn from the base (0,0) up to the flower tip */
  d: string;
  color: string;
  width: number;
  /** grow delay / duration (seconds) */
  delayGrow: number;
  durGrow: number;
  /** retract delay / duration (seconds) */
  delayRetract: number;
  durRetract: number;
  reduced: boolean;
};

/**
 * The stem. It reveals by animating `pathLength` 0 → 1 (drawn upward from the
 * base) and retracts 1 → 0, so the flower literally grows out of the character.
 */
export function Stem({ d, color, width, delayGrow, durGrow, delayRetract, durRetract, reduced }: Props) {
  const variants = stage(
    { pathLength: 0, opacity: 0 },
    { pathLength: 1, opacity: 1 },
    { dg: delayGrow, durg: durGrow, dr: delayRetract, durr: durRetract, easeG: EASE_GROW, easeR: EASE_OUT, reduced },
  );
  return (
    <motion.path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      variants={variants}
    />
  );
}
