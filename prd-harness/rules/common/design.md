# Rule: Design

- The human's words win, then any existing brand/design system, then your choices. Look for
  tokens/brand assets before inventing a direction.
- Offer 2–3 distinct visual directions at G2; don't commit the human to one guess.
- Avoid AI-default looks (warm-cream+serif+terracotta, lone acid-green on near-black,
  purple→blue gradient hero, Inter-everywhere). Ground choices in the product's own world.
- Design light and dark with equal care; check WCAG contrast. Tokens flow
  primitive → semantic → component.
- **`design/design-system/tokens.json` is the machine-readable source of truth** (DTCG
  2025.10). Tier = top-level group (`primitive`/`semantic`/`component`); references go
  strictly downward (component → semantic → primitive) — a component that references a
  primitive directly is **tier leakage** and blocks the gate. Name semantic tokens by
  intent, never by appearance (`action.primary`, not `blue`). Declare contrast pairs with
  `$extensions.qm.contrastAgainst` (+ `min`, default 4.5). The validator (`skills/pipeline/
  tokens.mjs`) runs in the audit; `tokens.md` is human prose alongside it.
- `design/figma-links.md` is the source of design truth: record the canonical Figma/FigJam
  URLs (or the HTML-artifact paths when Figma is unavailable).
- Wireframes are clickable (HTML artifacts), not flat images; hi-fi maps to real, buildable
  components (reuse the project's component library).
