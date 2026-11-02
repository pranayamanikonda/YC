/*
 * H2F core — components.js
 * Finds repeated structures in the design tree and marks them as components.
 *   - structural signature = node type + visual style + layout + children signatures
 *     (text content and image sources are ignored → they become instance overrides)
 *   - a signature seen ≥ 2 times becomes a component; buttons / inputs always do
 *   - nested structure that only ever appears inside one parent component is not split out
 *   - components with the same family name (e.g. "Button") are grouped as variants
 * Pure, no DOM.
 */
(function (root) {
  const H2F = (root.H2F = root.H2F || {});

  const q = (v) => Math.round((v || 0) * 100) / 100;
  const col = (c) => (c ? [q(c.r), q(c.g), q(c.b), q(c.a === undefined ? 1 : c.a)].join(',') : '-');

  function paintSig(p) {
    if (!p) return '';
    if (p.type === 'SOLID') return 'S' + col({ ...p.color, a: p.opacity });
    if (p.type === 'IMAGE') return 'I'; // image source is an override
    return p.type + p.angle + (p.stops || []).map((s) => col(s.color) + '@' + q(s.position)).join(';');
  }

  function textSig(n) {
    return n.text.segments
      .map((s) => [s.family && s.family[0], s.weight, s.italic ? 'i' : '', s.size, s.lineHeight, s.letterSpacing, col(s.color), s.decoration, s.textCase].join('|'))
      .filter((v, i, a) => a.indexOf(v) === i) // style set, not run count
      .join('+') + '/' + n.text.align;
  }

  /** Signature of a component root: its own sizing is excluded (instances may HUG, FILL or be resized). */
  function rootSignature(n) {
    const full = signature(n);
    if (n.type !== 'FRAME') return full;
    return full.replace(/^F\(((?:[^|]*\|){11})[^|]*\|[^)]*\)/, (m, head) => 'F(' + head + '*|*)');
  }

  function signature(n) {
    if (n._sig) return n._sig;
    let sig;
    if (n.type === 'TEXT') sig = 'T(' + textSig(n) + ')' + n.sizingH;
    else if (n.type === 'SVG') sig = 'V(' + n.width + 'x' + n.height + ':' + hash(n.svg || '') + ')';
    else if (n.type === 'IMAGE') sig = 'I(' + (n.sizingH === 'FIXED' ? n.width : n.sizingH) + 'x' + (n.sizingV === 'FIXED' ? n.height : n.sizingV) + ':' + (n.radius || []).join(',') + ')';
    else {
      const l = n.layout || {};
      sig =
        'F(' +
        [
          n.tag,
          (n.fills || []).map(paintSig).join(';'),
          n.strokes ? n.strokes.weight + paintSig(n.strokes.paints[0]) : '',
          (n.radius || []).join(','),
          (n.effects || []).map((e) => e.type + e.offset?.y + e.radius).join(';'),
          l.mode,
          l.wrap ? 'w' : '',
          (l.padding || []).join(','),
          l.gap,
          l.primary,
          l.counter,
          n.sizingH === 'FIXED' ? 'W' + n.width : n.sizingH,
          n.sizingV === 'FIXED' ? 'H' + n.height : n.sizingV,
        ].join('|') +
        ')[' +
        (n.children || []).map(signature).join(',') +
        ']';
    }
    n._sig = sig;
    return sig;
  }

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function weight(n) {
    return 1 + (n.children || []).reduce((a, c) => a + weight(c), 0);
  }

  function hasVisual(n) {
    return (n.fills && n.fills.length) || n.strokes || (n.effects && n.effects.length);
  }

  function walk(n, fn, parent) {
    fn(n, parent);
    for (const c of n.children || []) walk(c, fn, n);
  }

  /** Primary = most saturated/dark solid fill; then Secondary, Tertiary; stroke-only = Outline; no fill = Ghost. */
  function rankVariants(nodes) {
    const out = new Map();
    const scored = [];
    for (const n of nodes) {
      const f = (n.fills || []).find((p) => p.type === 'SOLID' && (p.opacity === undefined || p.opacity > 0.05));
      if (!f) {
        out.set(n, n.strokes ? 'Outline' : 'Ghost');
        continue;
      }
      const { s, l } = H2F.grid.rgbToHsl(f.color);
      scored.push([n, s * (1 - Math.abs(l - 0.45))]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    const names = ['Primary', 'Secondary', 'Tertiary', 'Quaternary'];
    scored.forEach(([n], i) => out.set(n, names[i] || 'Style ' + (i + 1)));
    // labels must be unique; let the caller disambiguate duplicates
    return out;
  }

  const HUE_STATE = { green: 'Success', lime: 'Success', teal: 'Success', yellow: 'Warning', amber: 'Warning', orange: 'Warning', red: 'Danger', rose: 'Danger', pink: 'Danger', blue: 'Info', cyan: 'Info', indigo: 'Info' };

  /** Non-button families: hue → Success/Warning/Danger/Info; otherwise most used = Default, filled outlier = Active. */
  function stateVariants(nodes, counts) {
    const out = new Map();
    const fillOf = (n) => (n.fills || []).find((p) => p.type === 'SOLID');
    const hues = nodes.map((n) => {
      const f = fillOf(n);
      return f ? H2F.grid.colorName(f.color).split('/')[0] : null;
    });
    const states = hues.map((h) => h && HUE_STATE[h]);
    if (states.every(Boolean) && new Set(states).size === states.length) {
      nodes.forEach((n, i) => out.set(n, states[i]));
      return out;
    }
    let def = 0;
    counts.forEach((c, i) => {
      if (c > counts[def]) def = i;
    });
    const used = new Set(['Default']);
    nodes.forEach((n, i) => {
      if (i === def) return out.set(n, 'Default');
      let label = states[i] || (fillOf(n) && !fillOf(nodes[def]) ? 'Active' : 'Variant ' + (i + 1));
      if (used.has(label)) label += ' ' + (i + 1);
      used.add(label);
      out.set(n, label);
    });
    return out;
  }

  function variantLabel(n, i) {
    const f = (n.fills || []).find((p) => p.type === 'SOLID');
    if (f && H2F.grid) {
      const name = H2F.grid.colorName(f.color);
      return name.replace('/', ' ').replace(/^\w/, (c) => c.toUpperCase());
    }
    if (n.strokes) return 'Outline';
    if (!f) return 'Ghost';
    return 'Style ' + (i + 1);
  }

  /**
   * Mark components in a design document (mutates). Returns { components, count }.
   */
  function detectComponents(doc, opts) {
    opts = Object.assign({ minCount: 2, alwaysSemantic: true }, opts || {});
    const rootNode = doc.root;
    const occ = new Map(); // sig → nodes
    walk(rootNode, (n) => {
      if (n === rootNode || n.type !== 'FRAME') return;
      const w = weight(n);
      if (w < 2) return;
      if (!hasVisual(n) && w < 3) return;
      const sig = rootSignature(n);
      n._rsig = sig;
      if (!occ.has(sig)) occ.set(sig, []);
      occ.get(sig).push(n);
    });

    const candidates = new Set();
    for (const [sig, nodes] of occ) {
      const sem = nodes[0].semantic;
      if (nodes.length >= opts.minCount) candidates.add(sig);
      else if (opts.alwaysSemantic && (sem === 'button' || sem === 'input')) candidates.add(sig);
    }
    // singletons that look like a repeated family member (same name, tag and child shape) join it as a variant
    const shape = (n) => n.tag + '|' + (n.children || []).map((c) => c.type).join(',');
    const families = new Map();
    const familyAdded = new Set();
    for (const sig of candidates) {
      const n = occ.get(sig)[0];
      families.set(baseName(n) + '|' + shape(n), true);
    }
    for (const [sig, nodes] of occ) {
      if (candidates.has(sig)) continue;
      if (families.has(baseName(nodes[0]) + '|' + shape(nodes[0]))) {
        candidates.add(sig);
        familyAdded.add(sig);
      }
    }

    // drop candidates that are only ever structure of exactly one parent component
    const ancestorOf = new Map(); // sig → Set(ancestor sig)
    (function mark(n, anc) {
      const sig = n._rsig;
      let next = anc;
      if (sig && candidates.has(sig) && n !== rootNode) {
        if (!ancestorOf.has(sig)) ancestorOf.set(sig, new Set());
        ancestorOf.get(sig).add(anc || 'ROOT');
        next = sig;
      }
      for (const c of n.children || []) mark(c, next);
    })(rootNode, null);
    for (const [sig, ancs] of ancestorOf) {
      if (ancs.size === 1) {
        const a = [...ancs][0];
        if (a !== 'ROOT' && occ.get(a) && occ.get(sig).length === occ.get(a).length) {
          const sem = occ.get(sig)[0].semantic;
          if (sem !== 'button' && sem !== 'input' && !familyAdded.has(sig)) candidates.delete(sig);
        }
      }
    }

    // name components
    const comps = {};
    const usedNames = new Map();
    let idx = 0;
    for (const sig of candidates) {
      const nodes = occ.get(sig);
      const first = nodes[0];
      const key = 'c' + ++idx;
      let family = baseName(first);
      comps[key] = { key, family, name: family, count: nodes.length, sig };
      for (const n of nodes) n.componentKey = key;
      usedNames.set(family, (usedNames.get(family) || []).concat(key));
    }
    // variants for families with >1 distinct component
    for (const [family, keys] of usedNames) {
      if (keys.length === 1) continue;
      const labels = new Set();
      const firsts = keys.map((k) => occ.get(comps[k].sig)[0]);
      const ranked = firsts[0].semantic === 'button' ? rankVariants(firsts) : stateVariants(firsts, keys.map((k) => occ.get(comps[k].sig).length));
      keys.forEach((k, i) => {
        const first = occ.get(comps[k].sig)[0];
        let label = ranked.get(first) || variantLabel(first, i);
        while (labels.has(label)) label += ' ' + (i + 1);
        labels.add(label);
        comps[k].variant = label;
        comps[k].set = family;
        comps[k].name = family + '/' + label;
      });
    }
    // text component properties (for standalone components): up to 3 text layers
    for (const k of Object.keys(comps)) {
      const first = occ.get(comps[k].sig)[0];
      const texts = [];
      walk(first, (n) => {
        if (n.type === 'TEXT' && texts.length < 3) texts.push(n);
      });
      comps[k].textProps = texts.map((t, i) => (texts.length === 1 ? 'Label' : i === 0 ? 'Title' : 'Text ' + i));
    }
    // clean temp signatures
    walk(rootNode, (n) => {
      delete n._sig;
      delete n._rsig;
    });
    doc.components = comps;
    return { components: comps, count: Object.keys(comps).length };
  }

  function baseName(n) {
    if (n.semantic === 'button') return 'Button';
    if (n.semantic === 'input') return 'Input';
    if (n.semantic === 'checkbox') return 'Checkbox';
    let name = (n.name || 'Component').replace(/\s+\d+$/, '');
    if (/^(Frame|Group|Div|Span)$/i.test(name)) {
      if (n.tag === 'LI') return 'List item';
      if (n.effects && n.effects.length && n.radius && n.radius.some((r) => r > 0)) return 'Card';
      if (n.fills && n.fills.length && n.radius && n.radius.some((r) => r > 0)) return 'Card';
      return 'Item';
    }
    if (name === 'Article' || name === 'List item' || name === 'Link') return name;
    return name;
  }

  H2F.detectComponents = detectComponents;
  H2F._componentInternals = { signature, weight };
})(typeof globalThis !== 'undefined' ? globalThis : this);
