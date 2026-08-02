import { AnimatePresence } from "framer-motion";
import type { ButterflyConfig } from "../lib/types";
import { Butterfly } from "./Butterfly";

type Props = { butterflies: ButterflyConfig[]; reduced: boolean };

/**
 * The butterfly layer — an absolutely-positioned, non-interactive SVG above the
 * article. Butterflies enter while selecting and, when the list empties on
 * commit, play their curved fly-away `exit` before <AnimatePresence> unmounts
 * them.
 */
export function ButterflyLayer({ butterflies, reduced }: Props) {
  return (
    <svg className="garden-svg garden-butterflies" aria-hidden="true" focusable="false">
      <AnimatePresence>
        {butterflies.map((b) => (
          <Butterfly key={b.id} b={b} reduced={reduced} />
        ))}
      </AnimatePresence>
    </svg>
  );
}
