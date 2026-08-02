import type { GardenRange, HighlightRect } from "./types";

/** For a paragraph: a flat map from global char index → {node, offset}. */
export type CharMap = Array<{ node: Text; offset: number }>;

/** Build char maps for every interactive paragraph (rebuild on reflow). */
export function buildCharMaps(paragraphs: HTMLElement[]): Map<HTMLElement, CharMap> {
  const maps = new Map<HTMLElement, CharMap>();
  for (const p of paragraphs) {
    const map: CharMap = [];
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = n as Text;
      for (let i = 0; i < t.nodeValue!.length; i++) map.push({ node: t, offset: i });
    }
    maps.set(p, map);
  }
  return maps;
}

/**
 * The current selection, clipped to each interactive paragraph, expressed as
 * global character indices. Length-based so it is robust to selection endpoints
 * that land on element nodes (e.g. inside an <em>).
 */
export function gardenSelection(paragraphs: HTMLElement[], maps: Map<HTMLElement, CharMap>): GardenRange[] {
  const sel = window.getSelection();
  const out: GardenRange[] = [];
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return out;
  const range = sel.getRangeAt(0);
  for (const p of paragraphs) {
    if (!range.intersectsNode(p)) continue;
    const map = maps.get(p);
    if (!map || map.length === 0) continue;
    const full = document.createRange();
    full.selectNodeContents(p);
    const clip = range.cloneRange();
    if (clip.compareBoundaryPoints(Range.START_TO_START, full) < 0)
      clip.setStart(full.startContainer, full.startOffset);
    if (clip.compareBoundaryPoints(Range.END_TO_END, full) > 0)
      clip.setEnd(full.endContainer, full.endOffset);
    const pre = document.createRange();
    pre.setStart(full.startContainer, full.startOffset);
    pre.setEnd(clip.startContainer, clip.startOffset);
    const start = pre.toString().length;
    const end = start + clip.toString().length;
    if (end <= start) continue;
    out.push({ paragraph: p, start: Math.min(start, map.length - 1), end: Math.min(end, map.length) });
  }
  return out;
}

/** Article-relative rect + centre for a single character. */
export function charRect(
  stage: HTMLElement,
  map: CharMap,
  c: number,
): { cx: number; bottom: number } | null {
  if (c < 0 || c >= map.length) return null;
  const a = map[c];
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(a.node, a.offset + 1);
  const rects = r.getClientRects();
  if (!rects.length) return null;
  const rc = rects[rects.length - 1];
  const box = stage.getBoundingClientRect();
  return { cx: rc.left - box.left + rc.width / 2, bottom: rc.bottom - box.top };
}

/**
 * DOM Ranges for the garden selection, one per paragraph — the input to the CSS
 * Custom Highlight API. These are decoupled from `window.getSelection()`, so the
 * highlight persists after the native selection is cleared.
 */
export function rangesFor(selection: GardenRange[], maps: Map<HTMLElement, CharMap>): Range[] {
  const out: Range[] = [];
  for (const { paragraph, start, end } of selection) {
    const map = maps.get(paragraph);
    if (!map || map.length === 0) continue;
    const r = document.createRange();
    r.setStart(map[start].node, map[start].offset);
    const endA = map[Math.min(end, map.length - 1)];
    r.setEnd(endA.node, end >= map.length ? endA.offset + 1 : endA.offset);
    out.push(r);
  }
  return out;
}

/** Green highlight rectangles (one per line fragment) for the garden selection. */
export function highlightRects(
  stage: HTMLElement,
  selection: GardenRange[],
  maps: Map<HTMLElement, CharMap>,
): HighlightRect[] {
  const box = stage.getBoundingClientRect();
  const out: HighlightRect[] = [];
  for (const { paragraph, start, end } of selection) {
    const map = maps.get(paragraph);
    if (!map) continue;
    const r = document.createRange();
    r.setStart(map[start].node, map[start].offset);
    const endA = map[Math.min(end, map.length - 1)];
    r.setEnd(endA.node, end >= map.length ? endA.offset + 1 : endA.offset);
    for (const rc of Array.from(r.getClientRects())) {
      out.push({ left: rc.left - box.left, top: rc.top - box.top, width: rc.width, height: rc.height });
    }
  }
  return out;
}
