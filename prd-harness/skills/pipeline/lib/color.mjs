/**
 * Minimal, dependency-free color parsing + WCAG contrast. Supports the color
 * spaces we can compute a luminance for (hex, rgb/rgba, hsl/hsla). Modern spaces
 * (oklch, lab, named) return null so the caller can warn rather than guess.
 */

/**
 * @param {string} value
 * @returns {{ r: number, g: number, b: number } | null} sRGB 0..255, or null if
 *   the color space is unsupported / unparseable.
 */
export function parseColor(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();

  // #rgb / #rgba / #rrggbb / #rrggbbaa
  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  // rgb()/rgba()
  const rgb = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgb) {
    const parts = rgb[1].split(/[,\/\s]+/).filter(Boolean).slice(0, 3).map(Number);
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    const [r, g, b] = parts;
    return { r: clamp(r), g: clamp(g), b: clamp(b) };
  }

  // hsl()/hsla()
  const hsl = /^hsla?\(([^)]+)\)$/.exec(v);
  if (hsl) {
    const nums = hsl[1].split(/[,\/\s]+/).filter(Boolean);
    const h = parseFloat(nums[0]);
    const s = parseFloat(nums[1]) / 100;
    const l = parseFloat(nums[2]) / 100;
    if ([h, s, l].some((n) => Number.isNaN(n))) return null;
    return hslToRgb(h, s, l);
  }

  return null; // oklch, lab, named, etc. — unsupported here.
}

/** @param {number} n */
function clamp(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/**
 * @param {number} h degrees
 * @param {number} s 0..1
 * @param {number} l 0..1
 * @returns {{ r: number, g: number, b: number }}
 */
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return { r: clamp((r + m) * 255), g: clamp((g + m) * 255), b: clamp((b + m) * 255) };
}

/**
 * @param {{ r: number, g: number, b: number }} rgb
 * @returns {number} WCAG relative luminance 0..1.
 */
export function relativeLuminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * WCAG contrast ratio between two colors.
 * @param {string} a
 * @param {string} b
 * @returns {number | null} ratio 1..21, or null if either color is unsupported.
 */
export function contrastRatio(a, b) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
