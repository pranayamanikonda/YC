# Flower Selection — procedural text-selection garden

Drag across the article and procedural SVG flowers grow out of the characters you
hold, with butterflies flitting among them. Release, and the selection **commits
to a persistent highlight** as the butterflies fly away and the flowers fold back
in (petal → bud → leaf → stem). Everything is seeded, so the same passage always
keeps the same quiet arrangement while you hold it, and a fresh arrangement
appears on reload.

This is the **React + TypeScript + Vite + Framer Motion** implementation. A
self-contained vanilla single-file version lives in the repo scratchpad /
published Artifact; both share the same algorithms.

## Lifecycle

The garden runs a small state machine (visible in the debug panel):

| Phase | What happens |
|---|---|
| **selecting** | Live green highlight follows the drag; flowers grow progressively; butterflies appear. |
| **committed** | On release, the selection's ranges are saved and registered as a **persistent custom highlight** (CSS Custom Highlight API); the native selection is cleared — the garden no longer depends on it. |
| **departing** | Butterflies fly away along curved paths; the flowers linger a moment. |
| **retracting** | Petals close, leaves fold, stems retract; each flower's SVG is removed only after its reverse exit animation finishes. |
| **highlight-only** | Only the persistent highlight and its highlighted text remain — no flowers, no butterflies. Clicking elsewhere does **not** remove it. |

Starting a new drag begins a fresh cycle and replaces the previous highlight.
Where the Custom Highlight API is unavailable, the committed highlight falls back
to persistent SVG rectangles (still decoupled from the native selection).

## Run

```bash
npm install
npm run dev        # local dev server
npm run typecheck  # tsc --noEmit  (no type errors)
npm run build      # tsc -b && vite build  (no build errors)
npm run preview    # serve the production build
```

## How it works

- **Seeded PRNG** (`lib/seededRandom.ts`) — `xmur3` (string → seed) + `sfc32`.
  The page seed is randomized once per load and fixed for the session, so plants
  never flicker; each plant's seed is derived from its slot id, so the same
  characters always grow the same flower.
- **Selection → characters** (`lib/selectionToCharIndex.ts`) — every interactive
  paragraph is walked into a flat `charIndex → {node, offset}` map. The live
  selection is clipped to each paragraph and measured **by length**
  (`range.toString().length`), which is robust to endpoints that land on element
  nodes (e.g. inside an `<em>`). `getClientRects()` gives per-character positions
  and per-line highlight fragments.
- **Plant slots** (`lib/proceduralPlantGenerator.ts`) — density places ~one slot
  per _N_ characters with collision-aware spacing; slot ids are bucketed by
  character index so a slot stays stable while the same characters remain
  selected. `plantConfig` deterministically expands a slot into a full
  `PlantConfig` (type, palette, height, bend, leaves, petals…).
- **Diff, don't rebuild** (`hooks/useTextSelection.ts`) — pointer/selection
  events only flag work; all measurement + diffing happen once per
  `requestAnimationFrame`. React state is committed **only** when the plant-id
  set or the highlight signature actually changes, so there is no `setState` per
  pointer pixel. New slots grow, removed slots retract, stable slots are kept.
- **Growth staging** (`components/*` + `lib/timing.ts`, `lib/anim.ts`) — Framer
  Motion variants (`hidden` / `grow` / `retract`) propagate from each `<Plant>`
  down to its stem, leaves, and flower head. The stem draws itself with
  `pathLength`, leaves scale from their attach points, then the head opens
  bud → petals → centre — with the full order reversed on retract. `<AnimatePresence>`
  keeps a removed plant mounted until its reverse animation finishes.
  Positioning always lives on plain `<g transform>` wrappers while scale/opacity
  animate on inner elements (`transform-box: fill-box`), so the SVG position and
  the animated transform never fight.
- **Highlight + layering** (`components/SelectionHighlight.tsx`, `styles.css`) —
  while selecting, a scoped `::selection` rule recolours the selected text white
  and makes the native bar transparent; contrast-safe green rounded rects
  (`#167c3c`, ≈ 4.9:1 vs white) are drawn **below** the text as the live
  highlight. On commit this converts to a `::highlight(garden-committed)` custom
  highlight painted on the real text (`lib/persistentHighlight.ts`), so it
  persists independently of the native selection. Paint order is botanical layer
  → green highlight → article text → butterflies, so text stays fully readable.
- **Butterflies** (`lib/butterflies.ts`, `components/Butterfly.tsx`) — derived
  from the plants (~one per five, capped, seeded and keyed to a plant id so they
  don't flicker). They hover with flapping wings while present and, when the list
  empties on commit, play a curved fly-away `exit` before `<AnimatePresence>`
  unmounts them. Suppressed entirely under reduced motion.

## Accessibility & performance

- The article is semantic HTML and reads/selects normally with JavaScript
  disabled; overlays are `aria-hidden` and `pointer-events: none`, so native
  copy, selection, and keyboard selection (shift+arrows) are untouched.
- `prefers-reduced-motion: reduce` (or the debug **Preview reduced-motion**
  toggle) collapses all growth timings to an instant snap — a static arrangement,
  no animation.
- Transform/opacity-only animations, one rAF measurement pass, a capped plant
  count, and memoized configs keep interaction smooth.

## Debug panel

Collapsed by default (bottom-right). Density, spacing, max plants, grow/retract
speed, cross-plant stagger, stem/flower sizing, selection colour, reduced-motion
preview, highlight-rect outlines, plant-origin markers, and a reseed button.

## Module map (matches the spec)

```
src/
  lib/
    types.ts                    PlantConfig, GardenConfig, Phase, ButterflyConfig
    seededRandom.ts             xmur3 + sfc32 + rngFrom + randomSeed
    selectionToCharIndex.ts     char maps, gardenSelection, highlightRects, rangesFor
    proceduralPlantGenerator.ts slotsFor + plantConfig
    butterflies.ts              butterfliesFor
    persistentHighlight.ts      CSS Custom Highlight API register/clear
    palette.ts                  colours + DEFAULT_CONFIG
    timing.ts                   grow/retract stage delays
    anim.ts                     Framer variant builder + easings
  hooks/
    useTextSelection.ts         rAF-batched lifecycle → phase + plants + butterflies + highlights
    useSeededRandom.ts          stable seeded generator factory
  components/
    FlowerSelectionArticle.tsx  article + overlays (paint order)
    BotanicalOverlay.tsx        AnimatePresence of <Plant>
    SelectionHighlight.tsx      live / fallback green highlight rects
    ButterflyLayer.tsx  Butterfly.tsx
    Plant.tsx  Stem.tsx  Leaf.tsx  FlowerHead.tsx
    DebugPanel.tsx
  App.tsx  main.tsx  styles.css
```
