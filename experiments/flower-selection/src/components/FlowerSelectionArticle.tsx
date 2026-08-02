import { useLayoutEffect, useRef } from "react";
import type { GardenConfig } from "../lib/types";
import { useTextSelection } from "../hooks/useTextSelection";
import { BotanicalOverlay } from "./BotanicalOverlay";
import { SelectionHighlight } from "./SelectionHighlight";
import { ButterflyLayer } from "./ButterflyLayer";

type Props = { cfg: GardenConfig; reduced: boolean };

/**
 * The editorial article and its two overlays. The DOM order is the paint order
 * the spec asks for: botanical layer (back) → green highlight → article text
 * (front). Overlays are absolutely positioned and non-interactive, so native
 * selection, copy, and paragraph layout are completely untouched — the article
 * is fully readable and selectable with JavaScript disabled.
 */
export function FlowerSelectionArticle({ cfg, reduced }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const paragraphsRef = useRef<HTMLElement[]>([]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (stage) paragraphsRef.current = Array.from(stage.querySelectorAll<HTMLElement>("[data-garden]"));
  }, []);

  const { phase, plants, butterflies, highlights } = useTextSelection(stageRef, paragraphsRef, cfg, reduced);

  return (
    <div className="garden-stage" ref={stageRef} data-garden data-phase={phase}>
      <BotanicalOverlay plants={plants} cfg={cfg} reduced={reduced} />
      <SelectionHighlight rects={highlights} color={cfg.selColor} debugOutline={cfg.showRects} />

      <article className="garden-article">
        <p className="garden-eyebrow">A field guide to attention</p>
        <h1>Select a sentence and watch it grow.</h1>

        <p data-garden>
          Reading is a kind of tending. Your eye moves along a line the way a hand moves along a
          row, pausing where something catches, lingering where the light is good. Drag across
          these words and the margin answers back: stems rise out of the letters you hold, leaves
          unfold, and small blooms open in the space a sentence leaves behind.
        </p>

        <p data-garden>
          Nothing here is precious. Let go and the garden folds back into the page, petal before
          bud, leaf before stem, until the paragraph is only a paragraph again. Grow a little,
          grow a lot; the flowers are seeded to your selection, so the same passage always keeps
          the same quiet arrangement while you hold it.
        </p>

        <p data-garden>
          Read it slowly. Read it twice. The point is not the flowers but the noticing — the
          ordinary, renewable surprise of choosing where to put your attention, and finding that
          the choosing leaves something behind.
        </p>
      </article>

      <ButterflyLayer butterflies={butterflies} reduced={reduced} />
    </div>
  );
}
