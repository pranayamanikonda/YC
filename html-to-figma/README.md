# HTML to Figma

Turn **HTML files** and **screenshots** into **real Figma designs**, not flat layers:
auto layout, components and variants, colour/spacing/radius variables, text styles,
and spacing, padding and radius that land on a **4pt or 8pt grid**.

There are two front ends on one shared engine:

| | What it does |
|---|---|
| **Website** (`web/`) | Converts in the browser. Shows the original next to a preview of the Figma result, plus the layer tree, tokens and a grid-compliance report. **Copy SVG for canvas** pastes straight into a Figma file (named layers, editable text). **Copy for plugin** carries the full design (auto layout, components, variables) into the plugin. |
| **Figma plugin** (`plugin/`) | Runs the same engine inside Figma and builds the layers directly from HTML, an image, or a `.h2f.json` exported from the website. |

```text
 HTML ──► render at the chosen screen size ──► extract boxes + computed styles
image ──► Claude vision → grid-aligned flexbox HTML ──┘            │
                                                                    ▼
             layout inference (auto layout · HUG/FILL/FIXED · wrap · grouping)
                                                                    ▼
             grid snapping (4/8pt spacing & radius · 4pt sizes · type scale)
                                                                    ▼
             components & variants · tokens (variables + text styles)
                                                                    ▼
                         H2F document (.h2f.json) ──► Figma plugin builder
```

## Quick start

```bash
cd html-to-figma
npm run build      # inline the core into plugin/dist and web/dist (no dependencies)
npm run serve      # website at http://localhost:5173
npm test           # engine unit tests + browser end-to-end + plugin builder against a Figma API mock
```

The end-to-end tests use Playwright's Chromium if it's installed (`require('playwright')`). If it isn't, they're skipped.

### Install the Figma plugin

1. Open the **Figma desktop app**.
2. Go to **Plugins → Development → Import plugin from manifest…** and pick `html-to-figma/plugin/manifest.json`.
3. Run **Plugins → Development → HTML to Figma**.

The built files (`plugin/dist/code.js`, `plugin/dist/ui.html`) are committed, so this works without a build step.

## Getting a design into Figma

Figma's own clipboard format is private, so a web page can't paste auto layout onto the canvas directly. You get two routes:

- **Canvas paste:** on the website, press **Copy SVG for canvas**, click your Figma file and press ⌘V / Ctrl V. You get named layers, editable text, fills, gradients, borders, shadows and images. You don't get auto layout or components.
- **Full fidelity:** on the website, press **Copy for plugin**. In Figma, run **HTML to Figma** and press ⌘V anywhere in the plugin window, and it builds straight away. Dropping a downloaded `.h2f.json` works too.

## Using it

1. **Source:** paste or drop HTML, drop a screenshot, or (plugin only) drop a `.h2f.json` exported from the website.
2. **Screen size** (required): iPhone 16 (393×852), iPhone SE, Pro Max, Android, iPad mini / Pro, Laptop (1280×832), Desktop (1440×1024), Desktop HD, or a custom size. The HTML is laid out at exactly that size, so media queries and `vh` units resolve correctly.
3. **Design rules:** 8pt grid (4 allowed as a half-step below 16) or 4pt grid. Each kind of snapping can be switched on or off (padding and gaps, radius, fixed sizes and positions, type scale), and so can auto layout, components, and variables/styles.
4. **Convert.** The plugin creates:
   - a screen frame with auto layout all the way down
   - a **Components** section with main components, variant sets, and TEXT component properties
   - a **Tokens** variable collection (`color/*`, `space/*`, `radius/*`) and text styles (`Heading/32 Bold`, …)

   Variables and styles are bound to the layers and reused on later imports.

### Images → editable layers

Image mode sends the screenshot to Claude (model `claude-opus-5-5`) using **your** Anthropic API key. The prompt asks for HTML that is:

- flexbox-only
- on the grid
- on the type scale
- written with identical markup for repeated items

That HTML then goes through the normal converter, so the result has real auto layout and components. The key is stored only in the plugin's `clientStorage`, or in `localStorage` on the website if you opt in, and it is only sent to `api.anthropic.com`.

If you just want to trace over the screenshot, choose **Place as reference image** in the plugin.

## How CSS maps to Figma

| CSS | Figma |
|---|---|
| `display:flex` + `flex-direction` | Auto layout, horizontal/vertical (reverse orders are flattened) |
| Stacked block children / inline row / multi-column grid | Vertical / horizontal / horizontal + wrap, inferred from geometry |
| `gap`, consistent sibling margins | Item spacing (snapped, bound to `space/*`) |
| `padding` + `border` + first/last child margins | Padding (snapped) |
| `justify-content` | Primary alignment: Min / Center / Max / Space between |
| `align-items`, `stretch` | Counter alignment; stretched children become **Fill** |
| `flex-grow` | **Fill** on the primary axis |
| Shrink-to-fit boxes (badges, chips, inline-flex buttons) | **Hug** (measured with a `max-content` probe) |
| Explicit sizes (avatars, fixed-height inputs) | **Fixed**, snapped to 4pt |
| `max-width` + `margin:auto` | **Fill** + max width, centred |
| `margin-top:auto` / two far-apart groups | Space between |
| Uneven margins between siblings | Nested groups (e.g. "Heading group") so every stack has one gap |
| Side margins on block text | Wrapper frame whose padding is the margin |
| `position:absolute/fixed` | Absolute position inside auto layout |
| Overlapping children | Frame without auto layout (absolute x/y snapped to 4) |
| `border-radius`, `box-shadow`, `filter:blur`, `backdrop-filter` | Radius (pills kept), drop/inner shadow, layer/background blur |
| `linear-/radial-gradient`, `background-image:url()` | Gradient fill, image fill |
| `<img>`, `<picture>`, `<video poster>`, `<canvas>` | Image fill (WebP/AVIF re-encoded to PNG; identical images deduplicated) |
| Inline `<svg>` | Vector (`createNodeFromSvg`) with computed `fill`/`stroke`/`currentColor` baked in |
| Inline formatting (`<strong>`, `<em>`, `<a>`, `<br>`) | One text layer with styled ranges |
| `::before` / `::after` with string content | Materialised into real layers before extraction |
| `<input>`, `<select>`, `<textarea>`, `<button>` | Fixed-height frames with a vertically centred value or placeholder |

### Components

- **Repeated structures:** any frame whose structure and style repeat (text content and image sources are ignored) becomes a component. The repeats are instances with text and image overrides. A component's own sizing is ignored, so a Hug button and a Fill button are still the same component.
- **Buttons and inputs** always become components.
- **Variants:** members of the same family are combined into variant sets.
  - Buttons are named **Primary / Secondary / Outline / Ghost**.
  - Badges and states are named by hue: **Success / Warning / Danger / Info**. Otherwise **Default / Active**.
- **One-offs that match a family** join it as a variant, e.g. the active nav item.
- **TEXT component properties** (`Label`, `Title`, …) are added to standalone components.

## Project layout

```text
html-to-figma/
  core/                 shared engine (plain browser JS; inlined into both front ends)
    grid.js             4/8pt rules, type scale, colour naming
    extract.js          rendered DOM → raw boxes + computed styles (browser)
    layout.js           raw tree → auto layout / sizing / grouping / snapping (pure)
    components.js       repeated-structure detection, variants, text properties (pure)
    tokens.js           colour / spacing / radius variables, text styles (pure)
    pipeline.js         HTML → H2F document, audit, (de)serialisation, screen presets
    ai.js               image → HTML via the Claude Messages API (browser fetch)
  plugin/
    manifest.json
    src/code.js         Figma main thread: builds nodes, components, variables, styles
    src/ui.html         plugin UI (source / screen size / rules)
    dist/               built plugin (committed)
  web/src/index.html    website: landing page + converter + preview/layers/tokens/report
  web/dist/             built website (static, deploy anywhere)
  samples/              pricing (desktop), sign-in (mobile), dashboard (laptop)
  scripts/build.mjs     dependency-free build (inlines core into the two HTML files)
  scripts/serve.mjs     static server for the website
  test/                 node:test suites + a strict Figma Plugin API mock
  RESEARCH.md           what was researched and why the engine works the way it does
```

### The H2F document (`.h2f.json`)

This is the contract between the website, the plugin UI and the plugin main thread:

```js
{
  format: "h2f", version: 1,
  meta: { name, screen: { width, height, label }, rules: { base, snapSpacing, … }, source },
  root: DesignNode,            // FRAME | TEXT | IMAGE | SVG, with layout, sizingH/V, fills, strokes, radius, effects
  components: { c1: { name: "Button/Primary", family, variant, set, count, textProps } },
  tokens: { colors: [{ name: "color/indigo/400", hex }], text: [...], spacing: [...], radius: [...] },
  assets: { a1: { kind: "image", mime, b64 } | { kind: "svg", svg } },
  report: { snapped, grouped, autoLayoutFrames, audit: { score, violations }, warnings }
}
```

## Limits

- **No live URLs:** browsers block reading other sites' HTML (CORS). Save the page or copy its HTML instead, and set **Base URL** so relative assets resolve.
- **Not converted:**
  - CSS transforms (the bounding box is kept)
  - animations and hover states
  - `grid-template-areas` (imported as wrap or absolute)
  - icon-font pseudo-elements
- **Fonts:** matched by family and weight against the fonts available in Figma. Generic stacks fall back to Inter.
- **Fidelity vs. the grid:** snapping changes some values on purpose. The **Grid report** on the website lists what moved, and the plugin summary shows the grid score.
