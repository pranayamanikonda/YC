import { motion } from "framer-motion";
import type { ButterflyConfig } from "../lib/types";

type Props = { b: ButterflyConfig; reduced: boolean };

/**
 * A butterfly. While present it hovers (a gentle bob) with flapping wings; on
 * removal it flies away along a curved path (mid-curve control → drift target)
 * and fades — driven by Framer's `exit`, so <AnimatePresence> keeps it mounted
 * until the flight finishes. Positioning is a plain <g transform>; motion lives
 * on inner elements so SVG position and animation never collide.
 */
export function Butterfly({ b, reduced }: Props) {
  const s = b.scale;

  const enter = { opacity: 0, scale: 0.2 };
  const shown = {
    opacity: 1,
    scale: 1,
    transition: { duration: reduced ? 0.001 : 0.4, ease: [0.34, 1.56, 0.64, 1] as const },
  };
  const exit = reduced
    ? { opacity: 0, transition: { duration: 0.18 } }
    : {
        x: [0, b.curve, b.driftX],
        y: [0, b.driftY * 0.42, b.driftY],
        opacity: [1, 1, 0],
        rotate: [0, b.curve * 0.08, b.driftX > 0 ? 38 : -38],
        scale: [1, 1.05, 0.85],
        transition: { duration: 1.3, ease: "easeIn" as const, times: [0, 0.5, 1] },
      };

  const bob = reduced
    ? {}
    : {
        y: [0, -5, 0, -2, 0],
        x: [0, 3, 0, -3, 0],
        transition: { duration: 3.6 + b.phase, repeat: Infinity, ease: "easeInOut" as const },
      };

  const flap = reduced
    ? {}
    : { scaleX: [1, 0.32, 1], transition: { duration: 0.22, repeat: Infinity, ease: "easeInOut" as const } };

  const wing = (sign: 1 | -1) => (
    <motion.g
      animate={flap}
      style={{ transformBox: "fill-box", transformOrigin: sign === 1 ? "0% 50%" : "100% 50%" }}
    >
      <ellipse cx={sign * 6 * s} cy={-3 * s} rx={6 * s} ry={4.6 * s} fill={b.color} stroke="#2a2a2a" strokeWidth={0.6} />
      <ellipse cx={sign * 4.4 * s} cy={4 * s} rx={4 * s} ry={3 * s} fill={b.color} stroke="#2a2a2a" strokeWidth={0.6} />
      <circle cx={sign * 6 * s} cy={-3 * s} r={1.3 * s} fill={b.accent} />
    </motion.g>
  );

  return (
    <g data-butterfly transform={`translate(${b.x.toFixed(2)} ${b.y.toFixed(2)})`}>
      <motion.g initial={enter} animate={shown} exit={exit}>
        <motion.g animate={bob}>
          {wing(-1)}
          {wing(1)}
          <ellipse cx={0} cy={0} rx={1.4 * s} ry={6 * s} fill="#2a2a2a" />
          <path
            d={`M0 ${-5 * s} L ${-3 * s} ${-9 * s} M0 ${-5 * s} L ${3 * s} ${-9 * s}`}
            stroke="#2a2a2a"
            strokeWidth={0.6}
            fill="none"
            strokeLinecap="round"
          />
        </motion.g>
      </motion.g>
    </g>
  );
}
