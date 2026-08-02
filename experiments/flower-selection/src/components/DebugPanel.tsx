import type { GardenConfig } from "../lib/types";

type Props = {
  cfg: GardenConfig;
  onChange: (patch: Partial<GardenConfig>) => void;
  onReseed: () => void;
  plantCount: number;
  systemReduced: boolean;
};

type NumField = { key: keyof GardenConfig; label: string; min: number; max: number; step: number };

const FIELDS: NumField[] = [
  { key: "density", label: "Density (1 / N chars)", min: 1, max: 8, step: 1 },
  { key: "spacing", label: "Min spacing (px)", min: 6, max: 60, step: 1 },
  { key: "maxPlants", label: "Max plants", min: 4, max: 120, step: 1 },
  { key: "growMs", label: "Grow speed ×", min: 0.25, max: 3, step: 0.05 },
  { key: "reverseMs", label: "Retract speed ×", min: 0.25, max: 3, step: 0.05 },
  { key: "stagger", label: "Cross-plant stagger (ms)", min: 0, max: 140, step: 2 },
  { key: "stemMin", label: "Stem min (px)", min: 10, max: 90, step: 1 },
  { key: "stemMax", label: "Stem max (px)", min: 20, max: 160, step: 1 },
  { key: "flowerMin", label: "Flower min (px)", min: 4, max: 20, step: 1 },
  { key: "flowerMax", label: "Flower max (px)", min: 8, max: 30, step: 1 },
];

/**
 * A collapsible debug panel (§12 of the spec), collapsed by default. Every knob
 * writes straight into the garden config; changes that alter the slot set force
 * a clean recompute inside the selection hook.
 */
export function DebugPanel({ cfg, onChange, onReseed, plantCount, systemReduced }: Props) {
  return (
    <details className="garden-debug">
      <summary>Debug ({plantCount} live)</summary>
      <div className="garden-debug-body">
        {FIELDS.map((f) => (
          <label key={f.key as string} className="garden-debug-row">
            <span>
              {f.label}
              <em>{(cfg[f.key] as number).toString()}</em>
            </span>
            <input
              type="range"
              min={f.min}
              max={f.max}
              step={f.step}
              value={cfg[f.key] as number}
              onChange={(e) => onChange({ [f.key]: Number(e.target.value) } as Partial<GardenConfig>)}
            />
          </label>
        ))}

        <label className="garden-debug-row">
          <span>Selection colour</span>
          <input type="color" value={cfg.selColor} onChange={(e) => onChange({ selColor: e.target.value })} />
        </label>

        <label className="garden-debug-check">
          <input
            type="checkbox"
            checked={cfg.reducedPreview}
            onChange={(e) => onChange({ reducedPreview: e.target.checked })}
          />
          Preview reduced-motion {systemReduced ? "(system: on)" : "(system: off)"}
        </label>
        <label className="garden-debug-check">
          <input type="checkbox" checked={cfg.showRects} onChange={(e) => onChange({ showRects: e.target.checked })} />
          Outline highlight rects
        </label>
        <label className="garden-debug-check">
          <input
            type="checkbox"
            checked={cfg.showOrigins}
            onChange={(e) => onChange({ showOrigins: e.target.checked })}
          />
          Show plant origins
        </label>

        <button type="button" className="garden-debug-btn" onClick={onReseed}>
          Reseed garden
        </button>
        <p className="garden-debug-seed">seed: {cfg.seed}</p>
      </div>
    </details>
  );
}
