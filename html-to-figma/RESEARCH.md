# Research notes

These notes cover what was looked at before building, and how it shaped the design.

## Existing tools

- **html.to.design (divRIOTS):** the market reference. It takes a URL, or uses a Chrome extension for private or localhost pages.
  - Import options: auto layout, local styles and variables, and hover states as component variants.
  - The free tier is limited to roughly 10 imports a month.
  - Lesson: the import settings (auto layout, styles/variables) are what designers care about. Rendering in a real browser is required for fidelity.
- **Builder.io "Visual Copilot" / HTML-to-Figma:** also browser-capture based. Its output often needs manual clean-up of auto layout.
  - Lesson: inferring layout from flexbox alone is not enough. Block flow and margins must be handled too.

## Figma Plugin API facts the builder relies on

- **Plugin structure:** a main thread (`code.js`, with access to the document and no DOM) and a UI iframe (`ui.html`, with a DOM and network access). They talk through `postMessage`. Rendering and measuring the HTML therefore happens in the UI iframe, and node creation happens in the main thread.
- **Manifest:** `documentAccess: "dynamic-page"` is required for new plugins, which means the async APIs (`getLocalTextStylesAsync`, `setRangeTextStyleIdAsync`, `getLocalVariablesAsync`, …). `networkAccess.allowedDomains` gates fetches from the iframe. `*` is needed because imported pages reference arbitrary CSS, fonts and images, and `reasoning` explains why.
- **Auto layout:**
  - `layoutMode`, `itemSpacing`, `padding*`, `primaryAxisAlignItems` (including `SPACE_BETWEEN`) and `counterAxisAlignItems` (including `BASELINE`).
  - `layoutWrap` with `counterAxisSpacing` / `counterAxisAlignContent`; wrap is horizontal only.
  - `layoutPositioning = 'ABSOLUTE'` for out-of-flow children.
  - `minHeight` / `maxWidth`.
- **Sizing:** `layoutSizingHorizontal/Vertical` take `FIXED | HUG | FILL`. HUG is only valid on auto-layout frames and text, and FILL only on children of auto layout. Setting them anywhere else throws, so FILL must be set after `appendChild`. A HUG parent cannot have FILL children on the same axis, so the engine never emits that combination.
- **Components:**
  - `createComponentFromNode` turns an already-built frame into a component.
  - `createInstance` creates instances, and `combineAsVariants` needs children named `Property=Value`.
  - `addComponentProperty(name, 'TEXT', default)` plus `componentPropertyReferences = { characters }` creates editable labels, and `instance.setProperties` sets them.
- **Variables:** `createVariableCollection` / `createVariable(name, collection, type)` / `setValueForMode`. Scopes are `GAP` (gap and padding), `CORNER_RADIUS` and `WIDTH_HEIGHT`. `setBoundVariable(field, v)` binds numbers, and `figma.variables.setBoundVariableForPaint` binds colours.
- **Text:**
  - The node's current font must be loaded before changing `characters`.
  - Ranges are styled with `setRange*`.
  - `textAutoResize` is `WIDTH_AND_HEIGHT` for hug or `HEIGHT` for fixed-width wrapping text.
- **Images:** `figma.createImage(Uint8Array)` accepts PNG, JPEG and GIF, so the UI re-encodes WebP and AVIF to PNG through a canvas. `createNodeFromSvg` handles inline SVG.

## Design-system principles applied

- **8pt grid:** every spacing value is a multiple of 8, with **4 as a half-step for values under 16** (icon gaps, chips, tight lists). This matches Material, Apple HIG practice and most product design systems. The **4pt** option is for dense UIs.
- **Radius** follows the spacing steps. Anything at or above half the box's shorter side, or ≥ 999, stays a **pill**.
- **Sizes vs. spacing:** fixed dimensions snap to the 4pt baseline on both grids. They aren't spacing, and snapping them to 8 would distort screens (852 would become 856) and icons.
- **Type:** font sizes snap to a common product type scale (12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 36, 40, 48, …). Line heights snap to multiples of 4 (the baseline grid). Letter spacing is rounded to 0.1px.
- **One gap per stack:** Figma stacks have a single item spacing. CSS margins often produce uneven gaps, e.g. 8 / 24 / 24. Designers solve this by grouping, e.g. a "Heading group" with gap 8 inside a stack with gap 24, so the engine does the same instead of averaging.
- **Tokens:**
  - Near-identical colours are merged (ΔRGB < 3%).
  - Colours are named `family/step`, Tailwind-style (`slate/700`, `indigo/400`), with `white` / `black`.
  - Text styles are named by role and size: `Display/44 Bold`, `Body/15 Regular`.

## Calling Claude from the browser

The plugin UI and the website are single-file and bundler-free, so `core/ai.js` uses `fetch` against the Messages API rather than the SDK. The request:

- **Headers:**
  - `x-api-key` (the user's key)
  - `anthropic-version: 2023-06-01`
  - `anthropic-dangerous-direct-browser-access: true`, which is required when calling straight from a browser
- **Body:**
  - `model: "claude-opus-5-5"`
  - `max_tokens: 16000`
  - `output_config.effort: "medium"`
  - server-side refusal fallbacks (`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta)
- **Response handling:** `stop_reason` is checked for `refusal` and `max_tokens`. Only `text` blocks are read; thinking blocks are skipped.

## Sources

- html.to.design: https://html.to.design/home and https://html.to.design/docs/free-features
- Builder.io HTML to design: https://www.builder.io/blog/html-to-design
- Figma Plugin manifest and network access: https://developers.figma.com/docs/plugins/manifest and https://developers.figma.com/docs/plugins/making-network-requests
- Figma `layoutSizingHorizontal`: https://developers.figma.com/docs/plugins/api/properties/nodes-layoutsizinghorizontal
- Figma plugin update 69 (wrap, `counterAxisSpacing`): https://developers.figma.com/docs/plugins/updates/2023/06/30/version-1-update-69
