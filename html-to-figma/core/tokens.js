/*
 * H2F core — tokens.js
 * Collects design tokens from the design tree and names them:
 *   colors  → color/blue/500 …   (Figma color variables)
 *   spacing → space/16 …          (Figma number variables, scope GAP)
 *   radius  → radius/8, radius/full (number variables, scope CORNER_RADIUS)
 *   text    → Heading/32 Bold …   (Figma text styles)
 * Near-identical colours are merged. Pure, no DOM.
 */
(function (root) {
  const H2F = (root.H2F = root.H2F || {});

  function walk(n, fn) {
    fn(n);
    for (const c of n.children || []) walk(c, fn);
  }

  function hexOf(c) {
    return H2F.grid.toHex(c);
  }

  function collectTokens(doc) {
    const G = H2F.grid;
    const colorUse = new Map(); // hex → {color, count}
    const addColor = (c) => {
      if (!c) return;
      const h = hexOf(c);
      const e = colorUse.get(h) || { color: { r: c.r, g: c.g, b: c.b }, count: 0 };
      e.count++;
      colorUse.set(h, e);
    };
    const spacing = new Set();
    const radii = new Set();
    const typo = new Map();

    walk(doc.root, (n) => {
      for (const f of n.fills || []) if (f.type === 'SOLID') addColor(f.color);
      if (n.strokes) for (const p of n.strokes.paints) if (p.type === 'SOLID') addColor(p.color);
      if (n.layout && n.layout.mode && n.layout.mode !== 'NONE') {
        for (const p of n.layout.padding) if (p > 0) spacing.add(p);
        if (n.layout.gap > 0) spacing.add(n.layout.gap);
        if (n.layout.crossGap > 0) spacing.add(n.layout.crossGap);
      }
      for (const r of n.radius || []) if (r > 0) radii.add(r);
      if (n.type === 'TEXT') {
        for (const s of n.text.segments) {
          addColor(s.color);
          const key = [s.family[0], s.weight, s.italic ? 1 : 0, s.size, s.lineHeight || 'auto', s.letterSpacing].join('|');
          const e = typo.get(key) || { family: s.family, weight: s.weight, italic: s.italic, size: s.size, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, count: 0 };
          e.count++;
          typo.set(key, e);
        }
      }
    });

    // ---- merge near-identical colours into the most used one
    const entries = [...colorUse.entries()].sort((a, b) => b[1].count - a[1].count);
    const canonical = new Map(); // hex → canonical hex
    const kept = [];
    for (const [h, e] of entries) {
      const near = kept.find((k) => G.colorDistance(k.color, e.color) < 0.03);
      if (near) {
        canonical.set(h, near.hex);
        near.count += e.count;
      } else {
        kept.push({ hex: h, color: e.color, count: e.count });
        canonical.set(h, h);
      }
    }
    const names = new Set();
    const colors = kept.map((k) => {
      let name = 'color/' + G.colorName(k.color);
      let i = 2;
      const base = name;
      while (names.has(name)) name = base + '-' + i++;
      names.add(name);
      return { name, hex: k.hex, color: k.color, count: k.count };
    });
    const byHex = new Map(colors.map((c) => [c.hex, c]));
    const tokenFor = (c) => {
      if (!c) return null;
      const can = canonical.get(hexOf(c));
      const t = can && byHex.get(can);
      return t ? t.name : null;
    };

    // ---- text styles
    const tnames = new Set();
    const text = [...typo.values()]
      .sort((a, b) => b.size - a.size || b.weight - a.weight)
      .map((t) => {
        let name = `${G.typeRole(t.size)}/${t.size} ${G.weightName(t.weight)}${t.italic ? ' Italic' : ''}`;
        if (tnames.has(name)) name += ` · ${t.lineHeight ? t.lineHeight : 'auto'}`;
        let i = 2;
        const base = name;
        while (tnames.has(name)) name = base + ' ' + i++;
        tnames.add(name);
        return Object.assign({ name }, t);
      });
    const textKey = (s) => [s.family[0], s.weight, s.italic ? 1 : 0, s.size, s.lineHeight || 'auto', s.letterSpacing].join('|');
    const textByKey = new Map(text.map((t) => [[t.family[0], t.weight, t.italic ? 1 : 0, t.size, t.lineHeight || 'auto', t.letterSpacing].join('|'), t.name]));

    // ---- annotate nodes with token references
    walk(doc.root, (n) => {
      for (const f of n.fills || []) if (f.type === 'SOLID') f.token = tokenFor(f.color);
      if (n.strokes) for (const p of n.strokes.paints) if (p.type === 'SOLID') p.token = tokenFor(p.color);
      if (n.type === 'TEXT') for (const s of n.text.segments) {
        s.colorToken = tokenFor(s.color);
        s.textStyle = textByKey.get(textKey(s));
      }
    });

    const spacingTokens = [...spacing].sort((a, b) => a - b).map((v) => ({ name: 'space/' + v, value: v }));
    const radiusTokens = [...radii].sort((a, b) => a - b).map((v) => ({ name: v >= G.PILL ? 'radius/full' : 'radius/' + v, value: v }));
    doc.tokens = { colors, text, spacing: spacingTokens, radius: radiusTokens };
    return doc.tokens;
  }

  H2F.collectTokens = collectTokens;
})(typeof globalThis !== 'undefined' ? globalThis : this);
