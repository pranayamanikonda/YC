/**
 * A thin wrapper over the CSS Custom Highlight API. Registering a `Highlight`
 * paints the underlying text (styled via `::highlight(garden-committed)` in
 * styles.css) completely independently of `window.getSelection()`, so the
 * highlight survives clearing the native selection and clicking elsewhere.
 *
 * Where the API is unavailable, callers fall back to persistent SVG rectangles.
 */
export const COMMITTED_HL = "garden-committed";

export function supportsCustomHighlight(): boolean {
  return (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof (globalThis as unknown as { Highlight?: unknown }).Highlight === "function"
  );
}

/** Register the committed ranges as a persistent highlight. Returns success. */
export function registerHighlight(ranges: Range[]): boolean {
  if (!supportsCustomHighlight() || ranges.length === 0) return false;
  try {
    const Ctor = (globalThis as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
    const highlight = new Ctor(...ranges);
    (CSS as unknown as { highlights: Map<string, unknown> }).highlights.set(COMMITTED_HL, highlight);
    return true;
  } catch {
    return false;
  }
}

export function clearHighlight(): void {
  if (typeof CSS !== "undefined" && "highlights" in CSS) {
    (CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(COMMITTED_HL);
  }
}
