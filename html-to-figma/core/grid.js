/*
 * H2F core — grid.js
 * Design-principle rules: snapping spacing / radius / sizes to a 4pt or 8pt grid,
 * type scale, colour naming. Pure functions, no DOM. Shared by the website and
 * the Figma plugin UI (both inline this file at build time).
 */
(function (root) {
  const H2F = (root.H2F = root.H2F || {});

  const PILL = 9999;

  /** Common product type scale (px). Values outside are snapped to the nearest step. */
  const TYPE_SCALE = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 112, 128];

  const DEFAULT_RULES = {
    base: 8, // 4 or 8
    snapSpacing: true, // padding, gap
    snapRadius: true,
    snapSizes: true, // fixed widths / heights, absolute offsets
    snapType: true, // font sizes to TYPE_SCALE, line-heights to 4
    halfStep: true, // on an 8pt grid allow 4 for values below 16 (standard 8pt practice)
  };

  /**
   * Snap a spacing-like value to the grid.
   * 8pt grid: values < 16 may use the 4pt half-step (0, 4, 8, 12); larger snap to multiples of 8.
   * 4pt grid: nearest multiple of 4.
   * Values below 2px are border/rounding noise and become 0; 2px and up keep their intent (→ 4).
   */
  function snapSpace(v, rules) {
    const r = rules || DEFAULT_RULES;
    if (!isFinite(v)) return 0;
    const sign = v < 0 ? -1 : 1;
    let a = Math.abs(v);
    if (a < 2) return 0; // sub-2px "spacing" is border / rounding noise
    const base = r.base === 4 ? 4 : 8;
    let step = base;
    if (base === 8 && r.halfStep !== false && a < 16) step = 4;
    let out = Math.round(a / step) * step;
    if (out === 0) out = step === 8 && r.halfStep !== false ? 4 : step;
    return sign * out;
  }

  /** Radius: pills stay pills, everything else snaps like spacing. */
  function snapRadius(v, w, h, rules) {
    if (!isFinite(v) || v <= 0) return 0;
    const minSide = Math.min(w || Infinity, h || Infinity);
    if (v >= 999 || (isFinite(minSide) && v >= minSide / 2 - 0.5)) return PILL;
    return snapSpace(v, rules);
  }

  /** Fixed dimensions: 4pt aligned. */
  function snapSize(v) {
    if (!isFinite(v)) return 0;
    if (v <= 0) return 0;
    if (v < 2) return Math.max(1, Math.round(v)); // hairlines / dividers keep 1px
    // sizes are not spacing: they align to the 4pt baseline on both grids (keeps 852px screens at 852)
    return Math.max(4, Math.round(v / 4) * 4);
  }

  function snapFontSize(v) {
    let best = TYPE_SCALE[0];
    for (const s of TYPE_SCALE) if (Math.abs(s - v) < Math.abs(best - v)) best = s;
    if (v > TYPE_SCALE[TYPE_SCALE.length - 1]) return Math.round(v / 8) * 8;
    return best;
  }

  function snapLineHeight(v) {
    if (!isFinite(v) || v <= 0) return v;
    return Math.max(4, Math.round(v / 4) * 4);
  }

  /** Round to 2 decimals (avoid 15.999999 noise in output). */
  function r2(v) {
    return Math.round(v * 100) / 100;
  }

  // ---------- colour helpers ----------
  function toHex(c) {
    const h = (x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
    return ('#' + h(c.r) + h(c.g) + h(c.b)).toUpperCase();
  }

  function rgbToHsl(c) {
    const { r, g, b } = c;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    let h = 0,
      s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s, l };
  }

  const HUES = [
    [15, 'red'],
    [40, 'orange'],
    [50, 'amber'],
    [65, 'yellow'],
    [90, 'lime'],
    [150, 'green'],
    [175, 'teal'],
    [195, 'cyan'],
    [225, 'blue'],
    [250, 'indigo'],
    [275, 'violet'],
    [295, 'purple'],
    [335, 'pink'],
    [350, 'rose'],
    [361, 'red'],
  ];

  /** Tailwind-like semantic-ish name: gray/900, blue/500, white, black. */
  function colorName(c) {
    const { h, s, l } = rgbToHsl(c);
    if (l > 0.995) return 'white';
    if (l < 0.02) return 'black';
    let family = 'gray';
    if (s >= 0.12 && s < 0.32 && h >= 180 && h <= 260 && l > 0.08 && l < 0.97) family = 'slate';
    else if (s >= 0.12 && (l > 0.97 || l < 0.08) && s < 0.5) family = h >= 180 && h <= 260 ? 'slate' : 'gray';
    else if (s >= 0.12) {
      for (const [lim, name] of HUES) {
        if (h < lim) {
          family = name;
          break;
        }
      }
    }
    let step = Math.round((1 - l) * 10) * 100;
    step = Math.max(50, Math.min(950, step === 0 ? 50 : step));
    return family + '/' + step;
  }

  function colorDistance(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
  }

  const WEIGHT_NAMES = {
    100: 'Thin',
    200: 'ExtraLight',
    300: 'Light',
    400: 'Regular',
    500: 'Medium',
    600: 'SemiBold',
    700: 'Bold',
    800: 'ExtraBold',
    900: 'Black',
  };

  function weightName(w) {
    const k = Math.min(900, Math.max(100, Math.round((w || 400) / 100) * 100));
    return WEIGHT_NAMES[k];
  }

  /** Text style role from font size. */
  function typeRole(size) {
    if (size >= 40) return 'Display';
    if (size >= 24) return 'Heading';
    if (size >= 18) return 'Title';
    if (size >= 14) return 'Body';
    return 'Caption';
  }

  H2F.grid = {
    PILL,
    TYPE_SCALE,
    DEFAULT_RULES,
    snapSpace,
    snapRadius,
    snapSize,
    snapFontSize,
    snapLineHeight,
    r2,
    toHex,
    rgbToHsl,
    colorName,
    colorDistance,
    weightName,
    typeRole,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
