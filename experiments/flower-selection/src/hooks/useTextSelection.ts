import { useEffect, useRef, useState, type RefObject } from "react";
import type { ButterflyConfig, GardenConfig, GardenRange, HighlightRect, PlantConfig, Phase } from "../lib/types";
import {
  buildCharMaps,
  gardenSelection,
  highlightRects,
  rangesFor,
  type CharMap,
} from "../lib/selectionToCharIndex";
import { plantConfig, slotsFor } from "../lib/proceduralPlantGenerator";
import { butterfliesFor } from "../lib/butterflies";
import { clearHighlight, registerHighlight } from "../lib/persistentHighlight";

export type GardenState = {
  phase: Phase;
  plants: PlantConfig[];
  butterflies: ButterflyConfig[];
  /** SVG highlight rects to draw: live while selecting; committed rects as a
   *  fallback when the Custom Highlight API is unavailable; otherwise empty. */
  highlights: HighlightRect[];
};

/** How long flowers linger after commit while butterflies depart (ms). */
const DEPART_HOLD_MS = 480;
/** Time for the flower retract exit to finish before settling on highlight-only (ms). */
const RETRACT_SETTLE_MS = 1300;

/**
 * The garden lifecycle. While `selecting`, pointer/selection events flag work
 * and a single rAF pass derives plants + butterflies + live highlight (diffed by
 * id, committing React state only on real change — never per pointer pixel). On
 * pointer-up the selection is committed to a persistent custom highlight and the
 * native selection is released; butterflies fly away (`departing`), flowers then
 * retract, and the garden settles into `highlight-only` — where only the
 * persistent highlight remains and clicking elsewhere cannot remove it. A fresh
 * non-empty selection starts a new cycle, replacing the previous highlight.
 */
export function useTextSelection(
  stageRef: RefObject<HTMLElement>,
  paragraphsRef: RefObject<HTMLElement[]>,
  cfg: GardenConfig,
  reduced: boolean,
): GardenState {
  const [state, setState] = useState<GardenState>({ phase: "idle", plants: [], butterflies: [], highlights: [] });
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const mapsRef = useRef<Map<HTMLElement, CharMap>>(new Map());
  const knownRef = useRef<Map<string, PlantConfig>>(new Map());
  const sigRef = useRef("");
  const dirtyRef = useRef(true);
  const reflowRef = useRef(true);
  const rafRef = useRef(0);

  const phaseRef = useRef<Phase>("idle");
  const livePlantsRef = useRef<PlantConfig[]>([]);
  const committedRef = useRef<{ selection: GardenRange[]; rects: HighlightRect[]; custom: boolean } | null>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const stage = stageRef.current;
    const paragraphs = paragraphsRef.current;
    if (!stage || !paragraphs) return;

    const clearTimers = () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
    const commit = (next: GardenState) => {
      const c = cfgRef.current;
      const sig =
        next.phase +
        "|" +
        next.plants.map((p) => p.id).join(",") +
        "#" +
        c.seed +
        "|b:" +
        next.butterflies.map((b) => b.id).join(",") +
        "|h:" +
        next.highlights.map((r) => `${r.left | 0},${r.top | 0},${r.width | 0},${r.height | 0}`).join(";") +
        c.selColor;
      if (sig === sigRef.current) return;
      sigRef.current = sig;
      livePlantsRef.current = next.plants;
      setState(next);
    };

    const markDirty = () => {
      dirtyRef.current = true;
      schedule();
    };
    const markReflow = () => {
      reflowRef.current = true;
      markDirty();
    };
    const schedule = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
    };

    // Reset to a fresh selecting cycle: drop any committed highlight + timers.
    const resetForNewCycle = () => {
      clearTimers();
      clearHighlight();
      committedRef.current = null;
      knownRef.current.clear();
      phaseRef.current = "selecting";
      sigRef.current = "";
    };

    const loop = () => {
      rafRef.current = 0;
      const c = cfgRef.current;
      if (reflowRef.current) {
        mapsRef.current = buildCharMaps(paragraphs);
        reflowRef.current = false;
        dirtyRef.current = true;
        // realign a fallback (SVG) committed highlight after a reflow
        const cm = committedRef.current;
        if (cm && !cm.custom) {
          cm.rects = highlightRects(stage, cm.selection, mapsRef.current);
          const ph = phaseRef.current;
          if (ph === "highlight-only" || ph === "retracting") {
            commit({ phase: ph, plants: [], butterflies: [], highlights: cm.rects });
          }
        }
      }
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const phase = phaseRef.current;
      const selection = gardenSelection(paragraphs, mapsRef.current);

      if (phase === "idle" || phase === "selecting") {
        if (selection.length === 0) {
          phaseRef.current = "idle";
          commit({ phase: "idle", plants: [], butterflies: [], highlights: [] });
          return;
        }
        phaseRef.current = "selecting";
        const highlights = highlightRects(stage, selection, mapsRef.current);
        const slots = slotsFor(stage, selection, mapsRef.current, c, paragraphs);
        const wanted = new Set(slots.map((s) => s.id));
        for (const id of [...knownRef.current.keys()]) if (!wanted.has(id)) knownRef.current.delete(id);
        for (const slot of slots) if (!knownRef.current.has(slot.id)) knownRef.current.set(slot.id, plantConfig(slot, c));
        const plants = slots.map((s) => knownRef.current.get(s.id)!);
        const butterflies = reducedRef.current ? [] : butterfliesFor(plants, c);
        commit({ phase: "selecting", plants, butterflies, highlights });
        return;
      }

      // committed / departing / retracting / highlight-only:
      // a fresh non-empty selection (a new drag) starts a new cycle.
      if (selection.length > 0) {
        resetForNewCycle();
        dirtyRef.current = true;
        schedule();
      }
      // otherwise: hold the committed state; the persistent highlight remains.
    };

    const onPointerUp = () => {
      if (phaseRef.current !== "selecting") return;
      const selection = gardenSelection(paragraphs, mapsRef.current);
      if (selection.length === 0) {
        phaseRef.current = "idle";
        commit({ phase: "idle", plants: [], butterflies: [], highlights: [] });
        return;
      }
      // Commit: register a persistent custom highlight and release the native one.
      const ranges = rangesFor(selection, mapsRef.current);
      const rects = highlightRects(stage, selection, mapsRef.current);
      const custom = registerHighlight(ranges);
      committedRef.current = { selection, rects, custom };
      window.getSelection()?.removeAllRanges();

      // departing: butterflies fly away (list → []), flowers linger.
      phaseRef.current = "departing";
      commit({ phase: "departing", plants: livePlantsRef.current, butterflies: [], highlights: custom ? [] : rects });

      clearTimers();
      timersRef.current.push(
        window.setTimeout(() => {
          // retracting: flowers fold away (list → [] triggers their reverse exit).
          phaseRef.current = "retracting";
          commit({ phase: "retracting", plants: [], butterflies: [], highlights: custom ? [] : rects });
          timersRef.current.push(
            window.setTimeout(() => {
              phaseRef.current = "highlight-only";
              commit({ phase: "highlight-only", plants: [], butterflies: [], highlights: custom ? [] : rects });
            }, RETRACT_SETTLE_MS),
          );
        }, DEPART_HOLD_MS),
      );
    };

    document.addEventListener("selectionchange", markDirty);
    for (const ev of ["pointerdown", "pointermove"] as const)
      document.addEventListener(ev, markDirty, { passive: true });
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("resize", markReflow);
    const ro = new ResizeObserver(markReflow);
    ro.observe(stage);
    if (document.fonts?.ready) document.fonts.ready.then(markReflow);

    markReflow();
    return () => {
      document.removeEventListener("selectionchange", markDirty);
      for (const ev of ["pointerdown", "pointermove"] as const) document.removeEventListener(ev, markDirty);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("resize", markReflow);
      ro.disconnect();
      clearTimers();
      clearHighlight();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // stageRef/paragraphsRef are stable refs; re-run only if they change identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageRef, paragraphsRef]);

  // config changes that alter the live slot set → force a clean recompute
  useEffect(() => {
    if (phaseRef.current !== "selecting" && phaseRef.current !== "idle") return;
    knownRef.current.clear();
    sigRef.current = "";
    dirtyRef.current = true;
    const id = requestAnimationFrame(() => {
      dirtyRef.current = true;
      document.dispatchEvent(new Event("selectionchange"));
    });
    return () => cancelAnimationFrame(id);
  }, [cfg.density, cfg.spacing, cfg.maxPlants, cfg.maxButterflies, cfg.stemMin, cfg.stemMax, cfg.flowerMin, cfg.flowerMax, cfg.seed]);

  return state;
}
