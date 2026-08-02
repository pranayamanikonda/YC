import { useEffect, useRef, useState, type RefObject } from "react";
import type { GardenConfig, HighlightRect, PlantConfig } from "../lib/types";
import { buildCharMaps, gardenSelection, highlightRects, type CharMap } from "../lib/selectionToCharIndex";
import { plantConfig, slotsFor } from "../lib/proceduralPlantGenerator";

type State = { plants: PlantConfig[]; highlights: HighlightRect[] };

/**
 * Tracks the text selection and derives, in a single rAF pass, the set of plant
 * configs and highlight rectangles. Pointer/selection events only flag work;
 * measurement + diffing happen once per frame. React state is committed only
 * when the plant-id set or the highlight signature actually changes, so we never
 * setState per pointer pixel.
 */
export function useTextSelection(
  stageRef: RefObject<HTMLElement>,
  paragraphsRef: RefObject<HTMLElement[]>,
  cfg: GardenConfig,
): State {
  const [state, setState] = useState<State>({ plants: [], highlights: [] });
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const mapsRef = useRef<Map<HTMLElement, CharMap>>(new Map());
  const knownRef = useRef<Map<string, PlantConfig>>(new Map());
  const sigRef = useRef({ plants: "", hl: "" });
  const dirtyRef = useRef(true);
  const reflowRef = useRef(true);
  const rafRef = useRef(0);

  useEffect(() => {
    const stage = stageRef.current;
    const paragraphs = paragraphsRef.current;
    if (!stage || !paragraphs) return;

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

    const loop = () => {
      rafRef.current = 0;
      const c = cfgRef.current;
      if (reflowRef.current) {
        mapsRef.current = buildCharMaps(paragraphs);
        reflowRef.current = false;
        dirtyRef.current = true;
      }
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const selection = gardenSelection(paragraphs, mapsRef.current);
      const highlights = highlightRects(stage, selection, mapsRef.current);
      const slots = slotsFor(stage, selection, mapsRef.current, c, paragraphs);

      // diff plant slots by id — keep stable configs, add new, drop removed
      const wanted = new Set(slots.map((s) => s.id));
      for (const id of [...knownRef.current.keys()]) if (!wanted.has(id)) knownRef.current.delete(id);
      for (const slot of slots) if (!knownRef.current.has(slot.id)) knownRef.current.set(slot.id, plantConfig(slot, c));
      const plants = slots.map((s) => knownRef.current.get(s.id)!);

      const plantsSig = plants.map((p) => p.id).join("|") + "#" + c.seed;
      const hlSig = highlights.map((r) => `${r.left | 0},${r.top | 0},${r.width | 0},${r.height | 0}`).join(";") + c.selColor;
      if (plantsSig !== sigRef.current.plants || hlSig !== sigRef.current.hl) {
        sigRef.current = { plants: plantsSig, hl: hlSig };
        setState({ plants, highlights });
      }
    };

    document.addEventListener("selectionchange", markDirty);
    for (const ev of ["pointerdown", "pointermove", "pointerup"] as const)
      document.addEventListener(ev, markDirty, { passive: true });
    window.addEventListener("resize", markReflow);
    const ro = new ResizeObserver(markReflow);
    ro.observe(stage);
    if (document.fonts?.ready) document.fonts.ready.then(markReflow);

    markReflow();
    return () => {
      document.removeEventListener("selectionchange", markDirty);
      for (const ev of ["pointerdown", "pointermove", "pointerup"] as const)
        document.removeEventListener(ev, markDirty);
      window.removeEventListener("resize", markReflow);
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // stageRef/paragraphsRef are stable refs; re-run only if they change identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageRef, paragraphsRef]);

  // config changes that alter the slot set → force a clean recompute
  useEffect(() => {
    knownRef.current.clear();
    sigRef.current = { plants: "", hl: "" };
    dirtyRef.current = true;
    if (!rafRef.current) rafRef.current = requestAnimationFrame(() => (rafRef.current = 0));
    // trigger the loop via a selectionchange-like nudge
    const id = requestAnimationFrame(() => {
      dirtyRef.current = true;
      document.dispatchEvent(new Event("selectionchange"));
    });
    return () => cancelAnimationFrame(id);
  }, [cfg.density, cfg.spacing, cfg.maxPlants, cfg.stemMin, cfg.stemMax, cfg.flowerMin, cfg.flowerMax, cfg.seed]);

  return state;
}
