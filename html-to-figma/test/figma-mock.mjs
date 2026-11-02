// A small, strict mock of the Figma Plugin API — enough to run plugin/dist/code.js in Node
// and assert on the node tree it builds. It enforces the rules that bite in real Figma:
//   • HUG only on auto-layout frames / text / auto-layout instances
//   • FILL only on children of auto-layout frames
//   • ABSOLUTE positioning only inside auto layout
//   • characters can only change after the node's font is loaded
//   • unknown effect / paint shapes are rejected
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

let nextId = 1;
const mixed = Symbol('mixed');

class BaseNode {
  constructor(type) {
    this.id = `${nextId++}:1`;
    this.type = type;
    this.name = type[0] + type.slice(1).toLowerCase();
    this.parent = null;
    this.x = 0;
    this.y = 0;
    this.width = 100;
    this.height = 100;
    this.opacity = 1;
    this.pluginData = {};
  }
  resize(w, h) {
    if (!(w > 0 && h > 0)) throw new Error(`resize: invalid size ${w}x${h}`);
    this.width = w;
    this.height = h;
  }
  resizeWithoutConstraints(w, h) {
    this.resize(w, h);
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  setPluginData(k, v) {
    this.pluginData[k] = v;
  }
}

class ContainerMixin extends BaseNode {
  constructor(type) {
    super(type);
    this.children = [];
  }
  appendChild(c) {
    if (c.parent) c.remove();
    c.parent = this;
    this.children.push(c);
  }
  findAll(fn) {
    const out = [];
    const w = (n) => {
      for (const c of n.children || []) {
        if (!fn || fn(c)) out.push(c);
        w(c);
      }
    };
    w(this);
    return out;
  }
}

function isAutoLayout(n) {
  return n && 'layoutMode' in n && n.layoutMode && n.layoutMode !== 'NONE';
}

const EFFECT_KEYS = {
  DROP_SHADOW: ['type', 'color', 'offset', 'radius', 'spread', 'visible', 'blendMode', 'showShadowBehindNode'],
  INNER_SHADOW: ['type', 'color', 'offset', 'radius', 'spread', 'visible', 'blendMode'],
  LAYER_BLUR: ['type', 'radius', 'visible', 'blurType'],
  BACKGROUND_BLUR: ['type', 'radius', 'visible', 'blurType'],
};

class FrameNode extends ContainerMixin {
  constructor(type = 'FRAME') {
    super(type);
    this._layoutMode = 'NONE';
    this.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    this.strokes = [];
    this.effects_ = [];
    this.cornerRadius = 0;
    this.paddingTop = this.paddingRight = this.paddingBottom = this.paddingLeft = 0;
    this.itemSpacing = 0;
    this.layoutWrap = 'NO_WRAP';
    this.primaryAxisAlignItems = 'MIN';
    this.counterAxisAlignItems = 'MIN';
    this._sizingH = 'FIXED';
    this._sizingV = 'FIXED';
    this.layoutPositioning_ = 'AUTO';
    this.clipsContent = true;
    this.boundVariables = {};
    this.componentPropertyReferences = null;
  }
  get layoutMode() {
    return this._layoutMode;
  }
  set layoutMode(v) {
    if (!['NONE', 'HORIZONTAL', 'VERTICAL'].includes(v)) throw new Error('bad layoutMode ' + v);
    this._layoutMode = v;
  }
  set effects(list) {
    for (const e of list) {
      const allowed = EFFECT_KEYS[e.type];
      if (!allowed) throw new Error('unknown effect ' + e.type);
      for (const k of Object.keys(e)) if (!allowed.includes(k)) throw new Error(`effect ${e.type} has unknown key ${k}`);
      if (e.type.endsWith('SHADOW') && (!e.color || !e.offset || e.blendMode === undefined)) throw new Error('shadow missing fields');
    }
    this.effects_ = list;
  }
  get effects() {
    return this.effects_;
  }
  get layoutPositioning() {
    return this.layoutPositioning_;
  }
  set layoutPositioning(v) {
    if (v === 'ABSOLUTE' && !isAutoLayout(this.parent)) throw new Error('ABSOLUTE positioning requires an auto-layout parent');
    this.layoutPositioning_ = v;
  }
  get layoutSizingHorizontal() {
    return this._sizingH;
  }
  set layoutSizingHorizontal(v) {
    checkSizing(this, v);
    this._sizingH = v;
  }
  get layoutSizingVertical() {
    return this._sizingV;
  }
  set layoutSizingVertical(v) {
    checkSizing(this, v);
    this._sizingV = v;
  }
  setBoundVariable(field, variable) {
    if (!(field in this)) throw new Error('cannot bind ' + field);
    this.boundVariables[field] = { type: 'VARIABLE_ALIAS', id: variable.id };
  }
}

function checkSizing(node, v) {
  if (v === 'HUG' && !(isAutoLayout(node) || node.type === 'TEXT')) throw new Error(`HUG is only valid on auto-layout frames and text (${node.name})`);
  if (v === 'FILL' && !isAutoLayout(node.parent)) throw new Error(`FILL is only valid on auto-layout children (${node.name})`);
}

class ComponentNode extends FrameNode {
  constructor() {
    super('COMPONENT');
    this.props = {};
    this.description = '';
  }
  addComponentProperty(name, type, def) {
    const id = `${name}#${nextId++}:0`;
    this.props[id] = { type, defaultValue: def };
    return id;
  }
  createInstance() {
    const inst = cloneTree(this, 'INSTANCE');
    inst.mainComponent = this;
    inst.setProperties = (props) => {
      for (const [id, val] of Object.entries(props)) {
        if (!this.props[id]) throw new Error('unknown property ' + id);
        for (const t of inst.findAll((n) => n.type === 'TEXT')) if (t.componentPropertyReferences && t.componentPropertyReferences.characters === id) t._chars = val;
      }
    };
    return inst;
  }
}

function cloneTree(src, asType) {
  let n;
  if (src.type === 'TEXT') n = new TextNode();
  else if (src.type === 'RECTANGLE') n = new RectNode();
  else n = new FrameNode(asType || (src.type === 'COMPONENT' ? 'FRAME' : src.type === 'INSTANCE' ? 'INSTANCE' : src.type));
  for (const k of Object.keys(src)) {
    if (['id', 'parent', 'children', 'type', 'props', 'mainComponent', 'createInstance', 'setProperties'].includes(k)) continue;
    const v = src[k];
    n[k] = typeof v === 'object' && v !== null ? JSON.parse(JSON.stringify(v)) : v;
  }
  if (src.children) for (const c of src.children) n.appendChild(cloneTree(c));
  return n;
}

class TextNode extends BaseNode {
  constructor() {
    super('TEXT');
    this.fontName = { family: 'Inter', style: 'Regular' };
    this._chars = '';
    this.textAutoResize = 'WIDTH_AND_HEIGHT';
    this.ranges = [];
    this.layoutPositioning_ = 'AUTO';
    this._sizingH = 'HUG';
    this._sizingV = 'HUG';
    this.componentPropertyReferences = null;
  }
  get characters() {
    return this._chars;
  }
  set characters(v) {
    if (!loadedFonts.has(this.fontName.family + '|' + this.fontName.style)) throw new Error('font not loaded: ' + JSON.stringify(this.fontName));
    this._chars = v;
  }
  get layoutPositioning() {
    return this.layoutPositioning_;
  }
  set layoutPositioning(v) {
    if (v === 'ABSOLUTE' && !isAutoLayout(this.parent)) throw new Error('ABSOLUTE requires auto-layout parent');
    this.layoutPositioning_ = v;
  }
  get layoutSizingHorizontal() {
    return this._sizingH;
  }
  set layoutSizingHorizontal(v) {
    checkSizing(this, v);
    this._sizingH = v;
  }
  get layoutSizingVertical() {
    return this._sizingV;
  }
  set layoutSizingVertical(v) {
    checkSizing(this, v);
    this._sizingV = v;
  }
  getRangeAllFontNames() {
    return [this.fontName];
  }
  checkRange(s, e) {
    if (s < 0 || e > this._chars.length || e <= s) throw new Error(`bad range ${s}-${e} for "${this._chars}"`);
  }
  setRangeFontName(s, e, f) {
    this.checkRange(s, e);
    if (!loadedFonts.has(f.family + '|' + f.style)) throw new Error('range font not loaded');
    this.ranges.push(['font', s, e, f]);
  }
  setRangeFontSize(s, e, v) {
    this.checkRange(s, e);
    this.ranges.push(['size', s, e, v]);
  }
  setRangeLineHeight(s, e, v) {
    this.checkRange(s, e);
    this.ranges.push(['lh', s, e, v]);
  }
  setRangeLetterSpacing(s, e, v) {
    this.checkRange(s, e);
  }
  setRangeFills(s, e, v) {
    this.checkRange(s, e);
    this.ranges.push(['fills', s, e, v]);
  }
  setRangeTextDecoration(s, e, v) {
    this.checkRange(s, e);
  }
  setRangeTextCase(s, e, v) {
    this.checkRange(s, e);
  }
  async setRangeTextStyleIdAsync(s, e, id) {
    this.checkRange(s, e);
    this.ranges.push(['style', s, e, id]);
    this._styleId = id;
  }
  getRangeTextStyleId() {
    return this._styleId || '';
  }
}

class RectNode extends BaseNode {
  constructor() {
    super('RECTANGLE');
    this.fills = [];
    this.strokes = [];
    this.cornerRadius = 0;
    this.layoutPositioning_ = 'AUTO';
    this._sizingH = 'FIXED';
    this._sizingV = 'FIXED';
  }
}
for (const k of ['layoutPositioning', 'layoutSizingHorizontal', 'layoutSizingVertical', 'effects']) {
  Object.defineProperty(RectNode.prototype, k, Object.getOwnPropertyDescriptor(FrameNode.prototype, k));
}
RectNode.prototype.setBoundVariable = function () {};

const loadedFonts = new Set();

export function createFigma() {
  nextId = 1;
  loadedFonts.clear();
  const page = new ContainerMixin('PAGE');
  const messages = [];
  const variables = [];
  const collections = [];
  const textStyles = [];
  const images = [];
  const figma = {
    mixed,
    currentPage: page,
    viewport: { scrollAndZoomIntoView() {} },
    ui: { postMessage: (m) => messages.push(m), onmessage: null, resize() {} },
    showUI() {},
    notify() {},
    closePlugin() {},
    clientStorage: { store: {}, async getAsync(k) { return this.store[k]; }, async setAsync(k, v) { this.store[k] = v; } },
    async listAvailableFontsAsync() {
      const fams = { Inter: ['Regular', 'Medium', 'Semi Bold', 'Bold', 'Italic', 'Bold Italic'], Roboto: ['Regular', 'Bold'], Georgia: ['Regular'], 'Roboto Mono': ['Regular'] };
      return Object.entries(fams).flatMap(([family, styles]) => styles.map((style) => ({ fontName: { family, style } })));
    },
    async loadFontAsync(f) {
      const ok = (await figma.listAvailableFontsAsync()).some((x) => x.fontName.family === f.family && x.fontName.style === f.style);
      if (!ok) throw new Error('font unavailable ' + JSON.stringify(f));
      loadedFonts.add(f.family + '|' + f.style);
    },
    createFrame: () => new FrameNode(),
    createText: () => new TextNode(),
    createRectangle: () => new RectNode(),
    createSection: () => {
      const s = new ContainerMixin('SECTION');
      page.appendChild(s);
      return s;
    },
    createImage(bytes) {
      if (!(bytes instanceof Uint8Array)) throw new Error('createImage expects Uint8Array');
      const hash = 'img' + images.length;
      images.push(bytes);
      return { hash };
    },
    createNodeFromSvg(svg) {
      if (!/^<svg/.test(svg.trim())) throw new Error('bad svg');
      const f = new FrameNode();
      f.name = 'svg';
      const v = new FrameNode('VECTOR');
      f.appendChild(v);
      return f;
    },
    createComponentFromNode(node) {
      const c = new ComponentNode();
      const parent = node.parent;
      for (const k of Object.keys(node)) if (!['id', 'type', 'parent', 'children'].includes(k)) c[k] = node[k];
      for (const ch of [...node.children]) c.appendChild(ch);
      if (parent) {
        parent.children[parent.children.indexOf(node)] = c;
        c.parent = parent;
      }
      return c;
    },
    combineAsVariants(comps, parent) {
      const set = new FrameNode('COMPONENT_SET');
      for (const c of comps) {
        if (!/=/.test(c.name)) throw new Error('variant names need Property=Value: ' + c.name);
        set.appendChild(c);
      }
      parent.appendChild(set);
      return set;
    },
    async getLocalTextStylesAsync() {
      return textStyles;
    },
    createTextStyle() {
      const s = { id: 'S:' + nextId++, name: '', type: 'TEXT' };
      textStyles.push(s);
      return s;
    },
    variables: {
      async getLocalVariableCollectionsAsync() {
        return collections;
      },
      async getLocalVariablesAsync() {
        return variables;
      },
      createVariableCollection(name) {
        const c = { id: 'VC:' + nextId++, name, modes: [{ modeId: 'm1', name: 'Mode 1' }], defaultModeId: 'm1', renameMode(id, n) { this.modes[0].name = n; } };
        collections.push(c);
        return c;
      },
      createVariable(name, collection, type) {
        if (typeof collection === 'string') throw new Error('pass the collection node, not its id');
        const v = { id: 'V:' + nextId++, name, resolvedType: type, variableCollectionId: collection.id, values: {}, scopes: ['ALL_SCOPES'], setValueForMode(m, val) { this.values[m] = val; } };
        variables.push(v);
        return v;
      },
      setBoundVariableForPaint(paint, field, v) {
        return Object.assign({}, paint, { boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: v.id } } });
      },
    },
  };
  return { figma, page, messages, variables, textStyles, images };
}

/** Load plugin code into a fresh VM context with the mock. */
export function loadPlugin(codePath) {
  const env = createFigma();
  const ctx = vm.createContext({ figma: env.figma, __html__: '<html></html>', console, setTimeout, Uint8Array, JSON, Math, Object, Array, Map, Set, Promise, String, Number, Error });
  vm.runInContext(readFileSync(codePath, 'utf8'), ctx, { filename: 'code.js' });
  env.send = async (msg) => {
    await env.figma.ui.onmessage(msg);
    return env.messages[env.messages.length - 1];
  };
  return env;
}
