import { motion } from "framer-motion";
import type { FlowerType } from "../lib/types";
import { EASE_OVERSHOOT, EASE_OUT, stage } from "../lib/anim";

type Props = {
  type: FlowerType;
  /** tip of the stem, article-local */
  x: number;
  y: number;
  size: number;
  petalCount: number;
  color: string;
  centerColor: string;
  stroke: string;
  /** per-stage delays (seconds), computed in Plant */
  budDelay: number;
  petalDelays: number[];
  centerDelay: number;
  budRetract: number;
  petalRetracts: number[];
  centerRetract: number;
  /** small deterministic rotation offset for the whole head */
  spin: number;
  reduced: boolean;
};

const OUTLINE = 0.8;

/**
 * The flower head. The bud opens first, then petals unfurl in a staggered ring
 * (with a soft overshoot), then the centre appears. On retract the order fully
 * reverses. Positioning is a plain <g transform>; every animated piece scales
 * from its own base via fill-box origins.
 */
export function FlowerHead(p: Props) {
  const { type, x, y, size, petalCount, color, centerColor, stroke, spin, reduced } = p;
  const durPetal = 0.3;
  const durCenter = 0.16;

  const petalTiming = (i: number) => ({
    dg: p.petalDelays[i] ?? 0,
    durg: durPetal,
    dr: p.petalRetracts[i] ?? 0,
    durr: durPetal * 0.7,
    easeG: EASE_OVERSHOOT,
    easeR: EASE_OUT,
    reduced,
  });

  const centerVariants = stage(
    { scale: 0, opacity: 0 },
    { scale: 1, opacity: 1 },
    { dg: p.centerDelay, durg: durCenter, dr: p.centerRetract, durr: durCenter, easeG: EASE_OVERSHOOT, easeR: EASE_OUT, reduced },
  );

  // A bud: single teardrop that scales up from the stem tip.
  if (type === "bud") {
    const len = size * 1.5;
    const w = size * 0.72;
    const d = `M0 0 C ${-w} ${-len * 0.45}, ${-w * 0.5} ${-len}, 0 ${-len} C ${w * 0.5} ${-len}, ${w} ${-len * 0.45}, 0 0 Z`;
    const budVariants = stage(
      { scale: 0, opacity: 0 },
      { scale: 1, opacity: 1 },
      { dg: p.budDelay, durg: durPetal, dr: p.budRetract, durr: durPetal * 0.7, easeG: EASE_OVERSHOOT, easeR: EASE_OUT, reduced },
    );
    return (
      <g transform={`translate(${x} ${y}) rotate(${spin})`}>
        <motion.path
          d={d}
          fill={color}
          stroke={stroke}
          strokeWidth={OUTLINE}
          strokeLinejoin="round"
          variants={budVariants}
          style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
        />
      </g>
    );
  }

  // A small cluster: several tiny blossoms scaling up around the tip.
  if (type === "cluster") {
    const r = size * 0.34;
    const ring = size * 0.72;
    return (
      <g transform={`translate(${x} ${y}) rotate(${spin})`}>
        {Array.from({ length: petalCount }, (_, i) => {
          const a = (i / petalCount) * Math.PI * 2;
          const cx = Math.cos(a) * ring;
          const cy = Math.sin(a) * ring - size * 0.3;
          const v = stage(
            { scale: 0, opacity: 0 },
            { scale: 1, opacity: 1 },
            petalTiming(i),
          );
          return (
            <motion.circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill={color}
              stroke={stroke}
              strokeWidth={OUTLINE}
              variants={v}
              style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}
            />
          );
        })}
        <motion.circle
          cx={0}
          cy={-size * 0.3}
          r={size * 0.36}
          fill={centerColor}
          stroke={stroke}
          strokeWidth={OUTLINE}
          variants={centerVariants}
          style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}
        />
      </g>
    );
  }

  // daisy = many thin petals; rounded = five broad petals.
  const rounded = type === "rounded";
  const len = rounded ? size * 1.0 : size * 1.18;
  const w = rounded ? size * 0.52 : size * 0.24;
  const petalPath = `M0 0 C ${-w} ${-len * 0.4}, ${-w} ${-len * 0.86}, 0 ${-len} C ${w} ${-len * 0.86}, ${w} ${-len * 0.4}, 0 0 Z`;
  const centerR = rounded ? size * 0.36 : size * 0.44;

  return (
    <g transform={`translate(${x} ${y}) rotate(${spin})`}>
      {Array.from({ length: petalCount }, (_, i) => {
        const ang = (i / petalCount) * 360;
        const v = stage({ scale: 0, opacity: 0 }, { scale: 1, opacity: 1 }, petalTiming(i));
        return (
          <g key={i} transform={`rotate(${ang})`}>
            <motion.path
              d={petalPath}
              fill={color}
              stroke={stroke}
              strokeWidth={OUTLINE}
              strokeLinejoin="round"
              variants={v}
              style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
            />
          </g>
        );
      })}
      <motion.circle
        cx={0}
        cy={0}
        r={centerR}
        fill={centerColor}
        stroke={stroke}
        strokeWidth={OUTLINE}
        variants={centerVariants}
        style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}
      />
    </g>
  );
}
