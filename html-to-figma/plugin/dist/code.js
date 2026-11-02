/*
 * HTML to Figma — plugin main thread.
 * Receives an H2F document from the UI (or a .h2f.json from the website) and builds:
 *   • a screen frame with auto layout (direction, gap, padding, alignment, wrap, HUG/FILL/FIXED)
 *   • components for repeated structures (+ variants, + TEXT component properties) and instances
 *   • color / spacing / radius variables and text styles, bound to the layers
 * Everything is snapped to the 4pt / 8pt grid upstream (core/layout.js).
 */

const UI_SIZE = { width: 460, height: 720 };
figma.showUI(__html__, Object.assign({ themeColors: true, title: 'HTML to Figma' }, UI_SIZE));

const PILL = 9999;
const post = (msg) => figma.ui.postMessage(msg);
const progress = (text, pct) => post({ type: 'progress', text, pct });

// ------------------------------------------------------------------ messages
figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'build') {
      const summary = await build(msg.doc, msg.options || {});
      post({ type: 'done', summary });
      figma.notify(`✓ Built "${summary.name}" — ${summary.frames} frames, ${summary.components} components, ${summary.instances} instances`);
    } else if (msg.type === 'place-image') {
      await placeImage(msg);
      post({ type: 'done', summary: { name: msg.name, placed: true } });
    } else if (msg.type === 'get-settings') {
      const key = (await figma.clientStorage.getAsync('anthropicKey')) || '';
      const prefs = (await figma.clientStorage.getAsync('prefs')) || {};
      post({ type: 'settings', key, prefs });
    } else if (msg.type === 'save-settings') {
      if ('key' in msg) await figma.clientStorage.setAsync('anthropicKey', msg.key || '');
      if (msg.prefs) await figma.clientStorage.setAsync('prefs', msg.prefs);
    } else if (msg.type === 'resize') {
      figma.ui.resize(msg.width || UI_SIZE.width, msg.height || UI_SIZE.height);
    } else if (msg.type === 'notify') {
      figma.notify(msg.text, { error: !!msg.error });
    } else if (msg.type === 'close') {
      figma.closePlugin();
    }
  } catch (e) {
    console.error(e);
    post({ type: 'error', message: String((e && e.message) || e) });
    figma.notify('HTML to Figma: ' + ((e && e.message) || e), { error: true });
  }
};

// ------------------------------------------------------------------ fonts
const WEIGHT_ALIASES = {
  100: ['Thin', 'Hairline'],
  200: ['ExtraLight', 'Extra Light', 'UltraLight', 'Ultra Light'],
  300: ['Light'],
  400: ['Regular', 'Normal', 'Book', 'Roman'],
  500: ['Medium'],
  600: ['SemiBold', 'Semi Bold', 'Semibold', 'DemiBold', 'Demi Bold'],
  700: ['Bold'],
  800: ['ExtraBold', 'Extra Bold', 'UltraBold', 'Heavy'],
  900: ['Black', 'Heavy'],
};
const GENERIC = /^(system-ui|-apple-system|blinkmacsystemfont|ui-sans-serif|sans-serif|ui-serif|serif|ui-monospace|monospace|cursive|fantasy|emoji|math|apple color emoji|segoe ui emoji|segoe ui symbol|noto color emoji)$/i;
const GENERIC_FALLBACK = { serif: 'Georgia', 'ui-serif': 'Georgia', monospace: 'Roboto Mono', 'ui-monospace': 'Roboto Mono' };

function styleWeight(style) {
  const s = style.toLowerCase().replace(/\s+/g, '');
  if (/thin|hairline/.test(s)) return 100;
  if (/extralight|ultralight/.test(s)) return 200;
  if (/light/.test(s)) return 300;
  if (/semibold|demibold/.test(s)) return 600;
  if (/extrabold|ultrabold/.test(s)) return 800;
  if (/black|heavy/.test(s)) return 900;
  if (/bold/.test(s)) return 700;
  if (/medium/.test(s)) return 500;
  return 400;
}

class FontBook {
  constructor() {
    this.families = null;
    this.cache = new Map();
    this.loaded = new Set();
  }
  async init() {
    const list = await figma.listAvailableFontsAsync();
    this.families = new Map();
    for (const f of list) {
      const k = f.fontName.family.toLowerCase();
      if (!this.families.has(k)) this.families.set(k, { family: f.fontName.family, styles: [] });
      this.families.get(k).styles.push(f.fontName.style);
    }
  }
  pickStyle(entry, weight, italic) {
    const w = Math.min(900, Math.max(100, Math.round((weight || 400) / 100) * 100));
    const styles = entry.styles;
    const isItalic = (s) => /italic|oblique/i.test(s);
    // exact alias match
    for (const alias of WEIGHT_ALIASES[w]) {
      const name = italic ? (w === 400 ? ['Italic', alias + ' Italic'] : [alias + ' Italic', alias + 'Italic']) : [alias];
      for (const n of name) if (styles.includes(n)) return n;
    }
    // nearest weight with the right slant
    const pool = styles.filter((s) => isItalic(s) === !!italic);
    const cands = pool.length ? pool : styles;
    let best = cands[0],
      bd = Infinity;
    for (const s of cands) {
      const d = Math.abs(styleWeight(s) - w);
      if (d < bd) (bd = d), (best = s);
    }
    return best;
  }
  resolve(families, weight, italic) {
    const key = (families || []).join(',') + '|' + weight + '|' + (italic ? 1 : 0);
    if (this.cache.has(key)) return this.cache.get(key);
    let entry = null;
    for (const fam of families || []) {
      const f = fam.toLowerCase();
      const mapped = GENERIC.test(f) ? GENERIC_FALLBACK[f] : fam;
      if (!mapped) continue;
      entry = this.families.get(mapped.toLowerCase());
      if (entry) break;
    }
    if (!entry) entry = this.families.get('inter') || this.families.values().next().value;
    const fontName = { family: entry.family, style: this.pickStyle(entry, weight, italic) };
    this.cache.set(key, fontName);
    return fontName;
  }
  async load(fontName) {
    const k = fontName.family + '|' + fontName.style;
    if (this.loaded.has(k)) return fontName;
    try {
      await figma.loadFontAsync(fontName);
      this.loaded.add(k);
      return fontName;
    } catch (e) {
      const fb = { family: 'Inter', style: 'Regular' };
      await figma.loadFontAsync(fb);
      this.loaded.add('Inter|Regular');
      return fb;
    }
  }
}

// ------------------------------------------------------------------ helpers
function walk(n, fn) {
  fn(n);
  for (const c of n.children || []) walk(c, fn);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function gradientTransform(angleDeg) {
  // CSS 90deg (left → right) is Figma's identity transform; rotate around the centre.
  const a = ((angleDeg - 90) * Math.PI) / 180;
  const cos = Math.cos(a),
    sin = Math.sin(a);
  return [
    [cos, sin, 0.5 - 0.5 * cos - 0.5 * sin],
    [-sin, cos, 0.5 + 0.5 * sin - 0.5 * cos],
  ];
}

// ------------------------------------------------------------------ builder
class Builder {
  constructor(doc, options) {
    this.doc = doc;
    this.opt = Object.assign({ components: true, tokens: true }, options);
    this.fonts = new FontBook();
    this.images = new Map();
    this.vars = { color: new Map(), number: new Map() };
    this.textStyles = new Map();
    this.mains = new Map(); // component key → ComponentNode
    this.mainTextProps = new Map(); // key → [propId per text index]
    this.stats = { frames: 0, texts: 0, images: 0, instances: 0, components: 0, variables: 0, textStyles: 0, warnings: [] };
    this.section = null;
  }

  warn(m) {
    if (this.stats.warnings.length < 50) this.stats.warnings.push(m);
  }

  // ---------- assets
  imageHash(assetId) {
    if (!assetId) return null;
    if (this.images.has(assetId)) return this.images.get(assetId);
    const a = this.doc.assets && this.doc.assets[assetId];
    let hash = null;
    if (a && a.bytes && a.kind === 'image') {
      try {
        hash = figma.createImage(a.bytes instanceof Uint8Array ? a.bytes : new Uint8Array(a.bytes)).hash;
      } catch (e) {
        this.warn('Unsupported image ' + assetId + ': ' + e.message);
      }
    }
    this.images.set(assetId, hash);
    return hash;
  }

  // ---------- tokens
  async setupTokens() {
    const t = this.doc.tokens || {};
    if (!this.opt.tokens) return;
    const collName = 'Tokens';
    let collection = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === collName);
    if (!collection) {
      collection = figma.variables.createVariableCollection(collName);
      try {
        collection.renameMode(collection.modes[0].modeId, 'Default');
      } catch (e) {}
    }
    const modeId = collection.defaultModeId || collection.modes[0].modeId;
    const existing = new Map();
    for (const v of await figma.variables.getLocalVariablesAsync()) {
      if (v.variableCollectionId === collection.id) existing.set(v.name, v);
    }
    const getVar = (name, type, value, scopes) => {
      let v = existing.get(name);
      if (!v || v.resolvedType !== type) {
        v = figma.variables.createVariable(name, collection, type);
        existing.set(name, v);
        this.stats.variables++;
      }
      v.setValueForMode(modeId, value);
      if (scopes) {
        try {
          v.scopes = scopes;
        } catch (e) {}
      }
      return v;
    };
    for (const c of t.colors || []) {
      try {
        this.vars.color.set(c.name, getVar(c.name, 'COLOR', { r: c.color.r, g: c.color.g, b: c.color.b, a: 1 }));
      } catch (e) {
        this.warn('Variable ' + c.name + ': ' + e.message);
      }
    }
    for (const s of t.spacing || []) {
      try {
        this.vars.number.set('space:' + s.value, getVar(s.name, 'FLOAT', s.value, ['GAP', 'WIDTH_HEIGHT']));
      } catch (e) {}
    }
    for (const r of t.radius || []) {
      try {
        this.vars.number.set('radius:' + r.value, getVar(r.name, 'FLOAT', r.value, ['CORNER_RADIUS']));
      } catch (e) {}
    }
    // text styles (reuse by name across imports)
    const localStyles = new Map((await figma.getLocalTextStylesAsync()).map((s) => [s.name, s]));
    for (const ts of t.text || []) {
      try {
        const fontName = await this.fonts.load(this.fonts.resolve(ts.family, ts.weight, ts.italic));
        let style = localStyles.get(ts.name);
        if (!style) {
          style = figma.createTextStyle();
          style.name = ts.name;
          this.stats.textStyles++;
        }
        style.fontName = fontName;
        style.fontSize = ts.size;
        style.lineHeight = ts.lineHeight ? { unit: 'PIXELS', value: ts.lineHeight } : { unit: 'AUTO' };
        style.letterSpacing = { unit: 'PIXELS', value: ts.letterSpacing || 0 };
        this.textStyles.set(ts.name, style);
      } catch (e) {
        this.warn('Text style ' + ts.name + ': ' + e.message);
      }
    }
  }

  bindNumber(node, field, kind, value) {
    if (!this.opt.tokens || !value) return;
    const v = this.vars.number.get(kind + ':' + value);
    if (!v) return;
    try {
      node.setBoundVariable(field, v);
    } catch (e) {}
  }

  paint(p) {
    if (p.type === 'SOLID') {
      let paint = { type: 'SOLID', color: { r: clamp01(p.color.r), g: clamp01(p.color.g), b: clamp01(p.color.b) }, opacity: p.opacity === undefined ? 1 : clamp01(p.opacity) };
      const v = p.token && this.opt.tokens && this.vars.color.get(p.token);
      if (v) {
        try {
          paint = figma.variables.setBoundVariableForPaint(paint, 'color', v);
        } catch (e) {}
      }
      return paint;
    }
    if (p.type === 'GRADIENT_LINEAR' || p.type === 'GRADIENT_RADIAL') {
      return {
        type: p.type,
        gradientTransform: p.type === 'GRADIENT_LINEAR' ? gradientTransform(p.angle) : [[1, 0, 0], [0, 1, 0]],
        gradientStops: p.stops.map((s) => ({ position: clamp01(s.position), color: { r: clamp01(s.color.r), g: clamp01(s.color.g), b: clamp01(s.color.b), a: clamp01(s.color.a) } })),
      };
    }
    if (p.type === 'IMAGE') {
      const hash = this.imageHash(p.asset);
      if (!hash) return null;
      return { type: 'IMAGE', imageHash: hash, scaleMode: p.scaleMode || 'FILL' };
    }
    return null;
  }

  paints(list) {
    return (list || []).map((p) => this.paint(p)).filter(Boolean);
  }

  // ---------- generic visual props
  applyVisual(node, d) {
    if ('fills' in node) node.fills = this.paints(d.fills);
    if (d.strokes) {
      node.strokes = this.paints(d.strokes.paints);
      node.strokeAlign = d.strokes.align || 'INSIDE';
      if (d.strokes.weights && 'strokeTopWeight' in node) {
        node.strokeTopWeight = d.strokes.weights[0];
        node.strokeRightWeight = d.strokes.weights[1];
        node.strokeBottomWeight = d.strokes.weights[2];
        node.strokeLeftWeight = d.strokes.weights[3];
      } else node.strokeWeight = d.strokes.weight;
      if (d.strokes.dashed) node.dashPattern = d.strokes.dashed;
    }
    if (d.radius && 'cornerRadius' in node) {
      const [tl, tr, br, bl] = d.radius;
      if (tl === tr && tr === br && br === bl) {
        node.cornerRadius = tl;
        if (tl && tl < PILL) ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'].forEach((f) => this.bindNumber(node, f, 'radius', tl));
      } else {
        node.topLeftRadius = tl;
        node.topRightRadius = tr;
        node.bottomRightRadius = br;
        node.bottomLeftRadius = bl;
      }
    }
    if (d.effects && d.effects.length) {
      const fx = [];
      for (const e of d.effects) {
        if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
          fx.push({ type: e.type, color: { r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.a }, offset: e.offset, radius: Math.max(0, e.radius), spread: e.spread || 0, visible: true, blendMode: 'NORMAL' });
        } else fx.push({ type: e.type, radius: Math.max(0, e.radius), visible: true });
      }
      try {
        node.effects = fx;
      } catch (e) {
        try {
          node.effects = fx.map((f) => (f.type.endsWith('BLUR') ? Object.assign({ blurType: 'NORMAL' }, f) : f));
        } catch (e2) {
          this.warn('Effects on ' + d.name + ': ' + e2.message);
        }
      }
    }
    if (d.opacity !== undefined && d.opacity < 1) node.opacity = d.opacity;
  }

  applyAutoLayout(frame, d) {
    const l = d.layout;
    if (!l || l.mode === 'NONE' || !l.mode) {
      frame.layoutMode = 'NONE';
      return;
    }
    frame.layoutMode = l.mode;
    if (l.wrap && l.mode === 'HORIZONTAL') {
      frame.layoutWrap = 'WRAP';
      frame.counterAxisSpacing = l.crossGap || 0;
      frame.counterAxisAlignContent = 'AUTO';
      this.bindNumber(frame, 'counterAxisSpacing', 'space', l.crossGap);
    }
    const [t, r, b, lft] = l.padding;
    frame.paddingTop = t;
    frame.paddingRight = r;
    frame.paddingBottom = b;
    frame.paddingLeft = lft;
    this.bindNumber(frame, 'paddingTop', 'space', t);
    this.bindNumber(frame, 'paddingRight', 'space', r);
    this.bindNumber(frame, 'paddingBottom', 'space', b);
    this.bindNumber(frame, 'paddingLeft', 'space', lft);
    frame.itemSpacing = l.gap || 0;
    if (l.primary !== 'SPACE_BETWEEN') this.bindNumber(frame, 'itemSpacing', 'space', l.gap);
    frame.primaryAxisAlignItems = l.primary || 'MIN';
    frame.counterAxisAlignItems = l.counter === 'BASELINE' && l.mode !== 'HORIZONTAL' ? 'MIN' : l.counter || 'MIN';
  }

  /** Size + sizing modes. Must run after the node has been appended to its parent. */
  applySizing(node, d, parentIsAuto) {
    const auto = d.layout && d.layout.mode && d.layout.mode !== 'NONE';
    const isText = node.type === 'TEXT';
    const isInstance = node.type === 'INSTANCE';
    const instAuto = isInstance && node.layoutMode && node.layoutMode !== 'NONE';
    if (d.absolute && parentIsAuto) {
      node.layoutPositioning = 'ABSOLUTE';
    }
    if (!isText) {
      try {
        node.resize(Math.max(1, d.width), Math.max(1, d.height));
      } catch (e) {}
    }
    const canHug = auto || isText || instAuto;
    const canFill = parentIsAuto && !d.absolute;
    const h = d.sizingH === 'FILL' && canFill ? 'FILL' : d.sizingH === 'HUG' && canHug ? 'HUG' : 'FIXED';
    const v = d.sizingV === 'FILL' && canFill ? 'FILL' : d.sizingV === 'HUG' && canHug ? 'HUG' : 'FIXED';
    if (!isText) {
      try {
        node.layoutSizingHorizontal = h;
      } catch (e) {}
      try {
        node.layoutSizingVertical = v;
      } catch (e) {}
    } else {
      // text: auto-resize decides hug behaviour
      try {
        if (h === 'FILL') node.layoutSizingHorizontal = 'FILL';
        if (v === 'FILL') node.layoutSizingVertical = 'FILL';
      } catch (e) {}
    }
    if (d.maxWidth) {
      try {
        node.maxWidth = d.maxWidth;
      } catch (e) {}
    }
    if (d.minHeight) {
      try {
        node.minHeight = d.minHeight;
      } catch (e) {}
    }
    if ((!parentIsAuto || d.absolute) && 'x' in node) {
      node.x = d.x;
      node.y = d.y;
    }
  }

  // ---------- text
  async setText(node, d, keepStyles) {
    const segs = d.text.segments;
    const full = segs.map((s) => s.text).join('');
    const fonts = [];
    for (const s of segs) fonts.push(await this.fonts.load(this.fonts.resolve(s.family, s.weight, s.italic)));
    // the node's current font must be loaded before characters can change
    if (node.fontName !== figma.mixed) await this.fonts.load(node.fontName);
    else for (const f of node.getRangeAllFontNames(0, node.characters.length)) await this.fonts.load(f);
    node.fontName = fonts[0];
    node.characters = full || ' ';
    if (keepStyles) return;
    let i = 0;
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      const start = i,
        end = i + s.text.length;
      i = end;
      if (end <= start) continue;
      const style = s.textStyle && this.opt.tokens && this.textStyles.get(s.textStyle);
      if (style) {
        try {
          await node.setRangeTextStyleIdAsync(start, end, style.id);
        } catch (e) {
          // fall back to raw properties below
        }
      }
      if (!style || node.getRangeTextStyleId(start, end) !== style.id) {
        node.setRangeFontName(start, end, fonts[k]);
        node.setRangeFontSize(start, end, s.size);
        node.setRangeLineHeight(start, end, s.lineHeight ? { unit: 'PIXELS', value: s.lineHeight } : { unit: 'AUTO' });
        node.setRangeLetterSpacing(start, end, { unit: 'PIXELS', value: s.letterSpacing || 0 });
      }
      node.setRangeFills(start, end, this.paints([{ type: 'SOLID', color: s.color, opacity: s.color.a === undefined ? 1 : s.color.a, token: s.colorToken }]));
      if (s.decoration && s.decoration !== 'NONE') node.setRangeTextDecoration(start, end, s.decoration);
      if (s.textCase && s.textCase !== 'ORIGINAL') node.setRangeTextCase(start, end, s.textCase);
    }
  }

  async buildText(d, parent, parentIsAuto) {
    const t = figma.createText();
    parent.appendChild(t);
    await this.setText(t, d);
    t.textAlignHorizontal = d.text.align || 'LEFT';
    const mode = d.text.autoResize || 'WIDTH_AND_HEIGHT';
    if (mode === 'WIDTH_AND_HEIGHT') t.textAutoResize = 'WIDTH_AND_HEIGHT';
    else {
      t.textAutoResize = 'NONE';
      t.resize(Math.max(1, d.width), Math.max(1, d.height));
      t.textAutoResize = 'HEIGHT';
    }
    this.applySizing(t, d, parentIsAuto);
    if (d.opacity !== undefined && d.opacity < 1) t.opacity = d.opacity;
    this.stats.texts++;
    return t;
  }

  // ---------- nodes
  async buildNode(d, parent, ctx) {
    const parentIsAuto = parent.type !== 'PAGE' && parent.type !== 'SECTION' && 'layoutMode' in parent && parent.layoutMode !== 'NONE';
    try {
      if (this.opt.components && d.componentKey && ctx.mainKey !== d.componentKey) {
        return await this.buildInstance(d, parent, parentIsAuto);
      }
      if (d.type === 'TEXT') return await this.buildText(d, parent, parentIsAuto);
      if (d.type === 'SVG') return this.buildSvg(d.svg, d, parent, parentIsAuto);
      if (d.type === 'IMAGE') {
        const a = d.image.asset && this.doc.assets[d.image.asset];
        if (a && a.kind === 'svg') return this.buildSvg(a.svg, d, parent, parentIsAuto);
        const r = figma.createRectangle();
        r.name = d.name || 'Image';
        parent.appendChild(r);
        const hash = this.imageHash(d.image.asset);
        this.applyVisual(r, Object.assign({}, d, { fills: null }));
        r.fills = hash
          ? [{ type: 'IMAGE', imageHash: hash, scaleMode: d.image.scaleMode || 'FILL' }]
          : [{ type: 'SOLID', color: { r: 0.9, g: 0.91, b: 0.93 } }];
        this.applySizing(r, d, parentIsAuto);
        this.stats.images++;
        return r;
      }
      // FRAME
      const f = figma.createFrame();
      f.name = d.name || 'Frame';
      parent.appendChild(f);
      f.fills = [];
      this.applyVisual(f, d);
      f.clipsContent = !!d.clip;
      this.applyAutoLayout(f, d);
      this.stats.frames++;
      // only the root of a main component may carry its own key; every descendant key becomes an instance
      for (const c of d.children || []) await this.buildNode(c, f, { mainKey: null });
      this.applySizing(f, d, parentIsAuto);
      return f;
    } catch (e) {
      this.warn(`${d.name || d.type}: ${e.message}`);
      return null;
    }
  }

  buildSvg(svg, d, parent, parentIsAuto) {
    let n;
    try {
      n = figma.createNodeFromSvg(svg);
    } catch (e) {
      n = figma.createRectangle();
      n.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.86, b: 0.88 } }];
      this.warn('SVG could not be parsed: ' + d.name);
    }
    n.name = d.name && d.name !== 'Frame' ? d.name : 'Icon';
    parent.appendChild(n);
    if (n.type === 'FRAME') n.clipsContent = false;
    this.applySizing(n, Object.assign({}, d, { sizingH: d.sizingH === 'FILL' ? 'FILL' : 'FIXED', sizingV: d.sizingV === 'FILL' ? 'FILL' : 'FIXED', layout: null }), parentIsAuto);
    this.stats.images++;
    return n;
  }

  // ---------- components
  findFirstOccurrence(key) {
    let found = null;
    walk(this.doc.root, (n) => {
      if (!found && n.componentKey === key) found = n;
    });
    return found;
  }

  async getMain(key) {
    if (this.mains.has(key)) return this.mains.get(key);
    const meta = this.doc.components[key];
    const data = this.findFirstOccurrence(key);
    // build the main component's content into the components section
    const holder = this.section;
    const d = Object.assign({}, data, {
      x: 0,
      y: 0,
      absolute: false,
      sizingH: data.sizingH === 'FILL' ? 'FIXED' : data.sizingH,
      sizingV: data.sizingV === 'FILL' ? 'FIXED' : data.sizingV,
      maxWidth: undefined,
    });
    const frame = await this.buildNode(d, holder, { mainKey: key });
    if (!frame) throw new Error('Could not build component ' + meta.name);
    const comp = figma.createComponentFromNode(frame);
    comp.name = meta.set ? `Variant=${meta.variant}` : meta.name;
    comp.description = `Generated by HTML to Figma from <${(data.tag || 'div').toLowerCase()}>. Used ${meta.count}×.`;
    this.stats.components++;
    // TEXT properties on standalone components (variants get direct overrides)
    const propIds = [];
    if (!meta.set) {
      const texts = comp.findAll((n) => n.type === 'TEXT').slice(0, 3);
      texts.forEach((t, i) => {
        try {
          const id = comp.addComponentProperty((meta.textProps && meta.textProps[i]) || 'Text ' + (i + 1), 'TEXT', t.characters);
          t.componentPropertyReferences = { characters: id };
          propIds[i] = id;
        } catch (e) {}
      });
    }
    this.mainTextProps.set(key, propIds);
    this.mains.set(key, comp);
    return comp;
  }

  async buildInstance(d, parent, parentIsAuto) {
    const main = await this.getMain(d.componentKey);
    const inst = main.createInstance();
    inst.name = this.doc.components[d.componentKey].family;
    parent.appendChild(inst);
    await this.applyOverrides(inst, d, d.componentKey);
    this.applySizing(inst, d, parentIsAuto);
    this.stats.instances++;
    return inst;
  }

  async applyOverrides(inst, d, key) {
    const propIds = this.mainTextProps.get(key) || [];
    let textIndex = 0;
    const props = {};
    const visit = async (node, data) => {
      if (!node || !data) return;
      if (data.type === 'TEXT' && node.type === 'TEXT') {
        const idx = textIndex++;
        const text = data.text.segments.map((s) => s.text).join('');
        const sameStyles = data.text.segments.length === 1;
        if (propIds[idx] && sameStyles) {
          if (node.characters !== text) props[propIds[idx]] = text;
        } else if (node.characters !== text || data.text.segments.length > 1) {
          await this.setText(node, data, false);
        }
        if (data.text.autoResize !== 'WIDTH_AND_HEIGHT' && data.sizingH === 'FIXED' && Math.abs(node.width - data.width) > 1) {
          try {
            node.resize(data.width, node.height);
            node.textAutoResize = 'HEIGHT';
          } catch (e) {}
        }
        return;
      }
      if (data.type === 'IMAGE' && node.type === 'RECTANGLE') {
        const hash = this.imageHash(data.image.asset);
        if (hash) node.fills = [{ type: 'IMAGE', imageHash: hash, scaleMode: data.image.scaleMode || 'FILL' }];
        return;
      }
      if (data.type === 'FRAME' && 'children' in node) {
        // background images differ per instance (e.g. card covers)
        if ((data.fills || []).some((p) => p.type === 'IMAGE')) node.fills = this.paints(data.fills);
        const kids = node.children;
        const dk = data.children || [];
        for (let i = 0; i < Math.min(kids.length, dk.length); i++) await visit(kids[i], dk[i]);
      }
    };
    // the instance root corresponds to the data root
    const kids = inst.children;
    const dk = d.children || [];
    if ((d.fills || []).some((p) => p.type === 'IMAGE')) inst.fills = this.paints(d.fills);
    for (let i = 0; i < Math.min(kids.length, dk.length); i++) await visit(kids[i], dk[i]);
    if (Object.keys(props).length) {
      try {
        inst.setProperties(props);
      } catch (e) {
        this.warn('Text property override failed: ' + e.message);
      }
    }
  }

  arrangeComponents() {
    if (!this.section) return;
    // combine variants
    const sets = new Map();
    for (const [key, comp] of this.mains) {
      const meta = this.doc.components[key];
      if (meta.set) {
        if (!sets.has(meta.set)) sets.set(meta.set, []);
        sets.get(meta.set).push(comp);
      }
    }
    for (const [name, comps] of sets) {
      try {
        const set = figma.combineAsVariants(comps, this.section);
        set.name = name;
        set.layoutMode = 'HORIZONTAL';
        set.layoutWrap = 'WRAP';
        set.itemSpacing = 24;
        set.counterAxisSpacing = 24;
        set.paddingTop = set.paddingRight = set.paddingBottom = set.paddingLeft = 24;
        set.layoutSizingHorizontal = 'HUG';
        set.layoutSizingVertical = 'HUG';
        set.strokes = [{ type: 'SOLID', color: { r: 0.592, g: 0.278, b: 1 } }];
        set.dashPattern = [10, 5];
        set.cornerRadius = 8;
      } catch (e) {
        this.warn('Variants for ' + name + ': ' + e.message);
      }
    }
    // stack section children vertically
    let y = 80,
      maxW = 0;
    for (const n of this.section.children) {
      n.x = 80;
      n.y = y;
      y += n.height + 48;
      maxW = Math.max(maxW, n.width);
    }
    this.section.resizeWithoutConstraints(Math.max(400, maxW + 160), Math.max(200, y + 32));
  }
}

// ------------------------------------------------------------------ entry points
function freeX() {
  let x = 0;
  for (const n of figma.currentPage.children) x = Math.max(x, n.x + n.width);
  return figma.currentPage.children.length ? Math.round((x + 200) / 8) * 8 : 0;
}

async function build(doc, options) {
  if (!doc || doc.format !== 'h2f') throw new Error('Not an H2F document');
  const b = new Builder(doc, options);
  progress('Loading fonts…', 5);
  await b.fonts.init();
  await b.fonts.load({ family: 'Inter', style: 'Regular' });
  if (b.opt.tokens) {
    progress('Creating variables & text styles…', 15);
    await b.setupTokens();
  }
  const x0 = freeX();
  const hasComponents = b.opt.components && Object.keys(doc.components || {}).length > 0;
  if (hasComponents) {
    b.section = figma.createSection();
    b.section.name = `Components — ${doc.meta.name}`;
    figma.currentPage.appendChild(b.section);
  }
  progress('Building layers…', 30);
  const rootData = Object.assign({}, doc.root, { componentKey: undefined });
  const screen = await b.buildNode(rootData, figma.currentPage, { mainKey: null });
  if (!screen) throw new Error('Failed to build the screen frame. ' + b.stats.warnings.join('; '));
  screen.name = doc.meta.name || 'Screen';
  screen.x = x0;
  screen.y = 0;
  try {
    screen.setPluginData('h2f', JSON.stringify({ screen: doc.meta.screen, rules: doc.meta.rules, generator: doc.meta.generator }));
  } catch (e) {}
  progress('Arranging components…', 90);
  if (b.section) {
    b.arrangeComponents();
    b.section.x = screen.x + screen.width + 160;
    b.section.y = 0;
  }
  const view = [screen];
  if (b.section) view.push(b.section);
  figma.currentPage.selection = [screen];
  figma.viewport.scrollAndZoomIntoView(view);
  progress('Done', 100);
  return Object.assign({ name: screen.name, width: screen.width, height: screen.height }, b.stats);
}

async function placeImage(msg) {
  const { bytes, width, height, name, screen } = msg;
  const img = figma.createImage(new Uint8Array(bytes));
  const w = screen ? screen.width : width;
  const h = Math.round((height / width) * w);
  const f = figma.createFrame();
  f.name = (name || 'Reference') + ' — reference';
  f.resize(w, Math.max(h, screen ? screen.height : h));
  f.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FIT' }];
  f.x = freeX();
  f.y = 0;
  f.locked = false;
  figma.currentPage.appendChild(f);
  figma.currentPage.selection = [f];
  figma.viewport.scrollAndZoomIntoView([f]);
}
