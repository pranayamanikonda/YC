import type { HighlightRect } from "../lib/types";

type Props = { rects: HighlightRect[]; color: string; debugOutline?: boolean };

/**
 * The green highlight layer, drawn *below* the article text. One rounded rect
 * per `getClientRects()` fragment, so multi-line selections wrap naturally. The
 * text itself is recoloured white via a scoped `::selection` rule in styles.css,
 * and the native selection bar is made transparent — this layer replaces it.
 */
export function SelectionHighlight({ rects, color, debugOutline }: Props) {
  return (
    <svg className="garden-svg garden-highlight" aria-hidden="true" focusable="false">
      {rects.map((r, i) => (
        <rect
          key={i}
          x={r.left - 1}
          y={r.top - 1}
          width={r.width + 2}
          height={r.height + 2}
          rx={4}
          ry={4}
          fill={color}
        />
      ))}
      {debugOutline &&
        rects.map((r, i) => (
          <rect
            key={`d-${i}`}
            x={r.left}
            y={r.top}
            width={r.width}
            height={r.height}
            fill="none"
            stroke="#ff3b8d"
            strokeWidth={1}
            strokeDasharray="3 2"
          />
        ))}
    </svg>
  );
}
