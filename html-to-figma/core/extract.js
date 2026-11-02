/*
 * H2F core — extract.js
 * Walks a *rendered* DOM (an iframe sized to the chosen screen) and produces a raw
 * tree of boxes + computed styles. Runs in a browser (website or Figma plugin UI).
 * No layout decisions are made here — see layout.js.
 */
(function (root) {
  const H2F = (root.H2F = root.H2F || {});

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'BASE']);
  const REPLACED = new Set(['IMG', 'SVG', 'INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'CANVAS', 'IFRAME', 'PICTURE', 'OBJECT', 'EMBED', 'BUTTON', 'HR']);
  const SVG_SHAPES = new Set(['path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'use', 'g']);

  // ---------------------------------------------------------------- colours
  let _ctx = null;
  function colorCtx() {
    if (_ctx) return _ctx;
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    _ctx = c.getContext('2d', { willReadFrequently: true });
    return _ctx;
  }

  function parseColor(str) {
    if (!str || str === 'transparent' || str === 'none') return null;
    let m = str.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
    if (m) {
      let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (a <= 0.001) return null;
      return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a };
    }
    // oklch(), color(display-p3 …), lab() … → let the canvas resolve it to sRGB.
    try {
      const ctx = colorCtx();
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = str;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      if (d[3] === 0) return null;
      return { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: d[3] / 255 };
    } catch (e) {
      return null;
    }
  }

  /** Split on commas that are not inside parentheses. */
  function splitTop(str) {
    const out = [];
    let depth = 0,
      cur = '';
    for (const ch of str) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function parseShadows(str) {
    if (!str || str === 'none') return [];
    const out = [];
    for (const part of splitTop(str)) {
      const colorMatch = part.match(/(rgba?\([^)]*\)|#[0-9a-f]{3,8}|oklch\([^)]*\)|color\([^)]*\))/i);
      const color = colorMatch ? parseColor(colorMatch[0]) : { r: 0, g: 0, b: 0, a: 1 };
      const rest = colorMatch ? part.replace(colorMatch[0], '') : part;
      const nums = (rest.match(/-?[\d.]+px|-?[\d.]+(?=\s|$)/g) || []).map(parseFloat);
      if (!color) continue;
      out.push({
        inset: /\binset\b/.test(part),
        x: nums[0] || 0,
        y: nums[1] || 0,
        blur: nums[2] || 0,
        spread: nums[3] || 0,
        color,
      });
    }
    return out;
  }

  function parseGradient(str) {
    const m = str.match(/^(repeating-)?(linear|radial)-gradient\((.*)\)$/s);
    if (!m) return null;
    const parts = splitTop(m[3]);
    let angle = 180; // CSS default: to bottom
    let i = 0;
    if (m[2] === 'linear') {
      const first = parts[0];
      const deg = first.match(/^(-?[\d.]+)(deg|turn|rad)$/);
      if (deg) {
        angle = parseFloat(deg[1]) * (deg[2] === 'turn' ? 360 : deg[2] === 'rad' ? 180 / Math.PI : 1);
        i = 1;
      } else if (/^to /.test(first)) {
        const dirs = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135, 'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315 };
        angle = dirs[first] ?? 180;
        i = 1;
      }
    } else if (!/^(rgb|#|hsl|oklch|color|[a-z]+$)/i.test(parts[0]) || /circle|ellipse|at /.test(parts[0])) {
      i = 1; // radial shape/position descriptor
    }
    const stops = [];
    for (; i < parts.length; i++) {
      const p = parts[i];
      const cm = p.match(/(rgba?\([^)]*\)|#[0-9a-f]{3,8}|oklch\([^)]*\)|color\([^)]*\)|hsla?\([^)]*\)|\b[a-z]+\b)/i);
      if (!cm) continue;
      const color = parseColor(cm[0]) || { r: 0, g: 0, b: 0, a: 0 };
      const pos = p.replace(cm[0], '').match(/(-?[\d.]+)%/);
      stops.push({ color, pos: pos ? parseFloat(pos[1]) / 100 : null });
    }
    if (stops.length < 2) return null;
    stops.forEach((s, idx) => {
      if (s.pos === null) s.pos = idx / (stops.length - 1);
    });
    return { type: m[2], angle, stops };
  }

  // ---------------------------------------------------------------- naming
  // utility classes (Tailwind & co.) are skipped when naming layers; plain words like "row" or "content" are kept
  const UTILITY_PREFIX = /^(?:[a-z0-9]+:|!|-)|^(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|w|h|size|min-w|min-h|max-w|max-h|text|font|bg|border|rounded|shadow|gap|space|items|justify|self|place|leading|tracking|z|inset|overflow|opacity|transition|duration|ease|delay|animate|col-span|row-span|grid-cols|grid-rows|order|grow|shrink|basis|object|aspect|ring|divide|cursor|select|whitespace|break|align|outline|fill|stroke|translate|rotate|scale|skew|origin|backdrop|blur|filter|decoration|mix|pointer|scroll|snap|touch|will|from|via|to|flex|grid|inline|top|left|right|bottom|line-clamp|sr|d|u|tw|js|is|has)-/;
  const UTILITY_WORD = /^(?:flex|grid|block|inline|inline-block|inline-flex|hidden|contents|absolute|relative|fixed|sticky|static|truncate|uppercase|lowercase|capitalize|underline|italic|antialiased|container|isolate|visible|invisible|clearfix|grow|shrink|transform|filter|shadow|rounded|border|active|selected|open|disabled|show|fade|in|clear|float|sr-only)$/;
  const isUtility = (c) => UTILITY_PREFIX.test(c) || UTILITY_WORD.test(c) || /[\[\]/:]/.test(c);

  const TAG_NAMES = {
    HEADER: 'Header', NAV: 'Nav', MAIN: 'Main', FOOTER: 'Footer', SECTION: 'Section', ARTICLE: 'Article', ASIDE: 'Sidebar',
    BUTTON: 'Button', A: 'Link', UL: 'List', OL: 'List', LI: 'List item', FORM: 'Form', INPUT: 'Input', TEXTAREA: 'Text area',
    SELECT: 'Select', IMG: 'Image', SVG: 'Icon', H1: 'Heading 1', H2: 'Heading 2', H3: 'Heading 3', H4: 'Heading 4',
    H5: 'Heading 5', H6: 'Heading 6', P: 'Paragraph', LABEL: 'Label', TABLE: 'Table', TR: 'Row', TD: 'Cell', TH: 'Header cell',
    FIGURE: 'Figure', FIGCAPTION: 'Caption', BLOCKQUOTE: 'Quote', HR: 'Divider', DIALOG: 'Dialog', VIDEO: 'Video',
    BODY: 'Page', SPAN: 'Span', DIV: 'Frame',
  };

  function humanize(s) {
    s = s.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function layerName(el) {
    const tag = el.tagName.toUpperCase();
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return humanize(aria).slice(0, 40);
    if (tag === 'IMG' && el.alt) return el.alt.slice(0, 40);
    const dn = el.getAttribute && (el.getAttribute('data-name') || el.getAttribute('data-figma-name'));
    if (dn) return dn;
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter((c) => c && !isUtility(c)) : [];
    const generic = tag === 'DIV' || tag === 'SPAN' || tag === 'SECTION';
    if (cls.length && generic) return humanize(cls[0]);
    if (el.id && generic) return humanize(el.id);
    return TAG_NAMES[tag] || humanize(tag.toLowerCase());
  }

  // ---------------------------------------------------------------- style readers
  const px = (v) => parseFloat(v) || 0;

  function fontFamilies(cs) {
    return cs.fontFamily.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }

  function textStyle(cs) {
    const size = px(cs.fontSize);
    const lh = cs.lineHeight === 'normal' ? null : px(cs.lineHeight);
    const ls = cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing);
    const deco = (cs.textDecorationLine || cs.textDecoration || '').includes('underline')
      ? 'UNDERLINE'
      : (cs.textDecorationLine || cs.textDecoration || '').includes('line-through')
      ? 'STRIKETHROUGH'
      : 'NONE';
    const tt = cs.textTransform;
    return {
      family: fontFamilies(cs),
      weight: parseInt(cs.fontWeight, 10) || 400,
      italic: cs.fontStyle === 'italic' || cs.fontStyle.startsWith('oblique'),
      size,
      lineHeight: lh,
      letterSpacing: ls,
      color: parseColor(cs.color) || { r: 0, g: 0, b: 0, a: 1 },
      decoration: deco,
      transform: tt === 'uppercase' ? 'UPPER' : tt === 'lowercase' ? 'LOWER' : tt === 'capitalize' ? 'TITLE' : 'ORIGINAL',
    };
  }

  function boxStyle(cs) {
    const bw = [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)];
    const bstyles = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle];
    for (let i = 0; i < 4; i++) if (bstyles[i] === 'none' || bstyles[i] === 'hidden') bw[i] = 0;
    const bc = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].map(parseColor);
    for (let i = 0; i < 4; i++) if (!bc[i]) bw[i] = 0;
    const gradients = [];
    let bgUrl = null;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      for (const layer of splitTop(cs.backgroundImage)) {
        const u = layer.match(/^url\(["']?(.*?)["']?\)$/);
        if (u) bgUrl = bgUrl || u[1];
        else {
          const g = parseGradient(layer);
          if (g) gradients.push(g);
        }
      }
    }
    return {
      display: cs.display,
      position: cs.position,
      flexDir: cs.flexDirection,
      flexWrap: cs.flexWrap,
      justify: cs.justifyContent,
      alignItems: cs.alignItems,
      alignSelf: cs.alignSelf,
      grow: parseFloat(cs.flexGrow) || 0,
      rowGap: cs.rowGap === 'normal' ? 0 : px(cs.rowGap),
      colGap: cs.columnGap === 'normal' ? 0 : px(cs.columnGap),
      pad: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
      bw,
      bc,
      bstyle: bstyles.find((s) => s !== 'none' && s !== 'hidden') || 'solid',
      radius: [px(cs.borderTopLeftRadius), px(cs.borderTopRightRadius), px(cs.borderBottomRightRadius), px(cs.borderBottomLeftRadius)],
      bg: parseColor(cs.backgroundColor),
      gradients,
      bgUrl,
      bgSize: cs.backgroundSize,
      shadows: parseShadows(cs.boxShadow),
      opacity: parseFloat(cs.opacity),
      overflowHidden: cs.overflowX !== 'visible' || cs.overflowY !== 'visible',
      textAlign: cs.textAlign,
      zIndex: cs.zIndex === 'auto' ? 0 : parseInt(cs.zIndex, 10) || 0,
      blur: blurOf(cs.filter),
      backdropBlur: blurOf(cs.backdropFilter || cs.webkitBackdropFilter),
    };
  }

  function blurOf(f) {
    const m = (f || '').match(/blur\(([\d.]+)px\)/);
    return m ? parseFloat(m[1]) : 0;
  }

  function hasVisualBox(s) {
    return !!(s.bg || s.gradients.length || s.bgUrl || s.bw.some((w) => w > 0) || s.shadows.length);
  }

  // ---------------------------------------------------------------- extractor
  function Extractor(doc, opts) {
    this.doc = doc;
    this.win = doc.defaultView;
    this.opts = opts || {};
    this.assets = {};
    this.assetJobs = [];
    this.warnings = [];
    this.nextId = 1;
    this.urlToAsset = new Map();
  }

  Extractor.prototype.rect = function (r) {
    return { x: r.left + this.win.scrollX, y: r.top + this.win.scrollY, w: r.width, h: r.height };
  };

  Extractor.prototype.cs = function (el, pseudo) {
    return this.win.getComputedStyle(el, pseudo || null);
  };

  Extractor.prototype.isInlineText = function (el) {
    if (el.nodeType === 3) return true;
    if (el.nodeType !== 1) return true; // comments
    const tag = el.tagName.toUpperCase();
    if (tag === 'BR' || tag === 'WBR') return true;
    if (REPLACED.has(tag) || el instanceof this.win.SVGElement) return false;
    const cs = this.cs(el);
    if (cs.display === 'none') return true; // ignored anyway
    if (cs.display !== 'inline' && cs.display !== 'contents') return false;
    if (cs.position === 'absolute' || cs.position === 'fixed') return false;
    for (const c of el.childNodes) if (!this.isInlineText(c)) return false;
    return true;
  };

  /** Collect styled text runs from an inline-only subtree. */
  Extractor.prototype.segments = function (el, out) {
    out = out || [];
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        const parent = node.parentElement;
        const cs = this.cs(parent);
        let t = node.textContent;
        const ws = cs.whiteSpace;
        if (!/^pre/.test(ws) && ws !== 'break-spaces') t = t.replace(/\s+/g, ' ');
        if (t) out.push({ text: t, ...textStyle(cs), href: parent.closest && parent.closest('a') ? true : undefined });
      } else if (node.nodeType === 1) {
        const tag = node.tagName.toUpperCase();
        if (tag === 'BR') {
          out.push({ text: '\n', ...textStyle(this.cs(node.parentElement)) });
          continue;
        }
        if (this.cs(node).display === 'none') continue;
        this.segments(node, out);
      }
    }
    return out;
  };

  /** Number of visual lines: cluster client rects whose vertical centres overlap. */
  function countLines(rects) {
    const rows = [];
    for (const r of rects) {
      if (r.width <= 0 || r.height <= 0) continue;
      const cy = r.top + r.height / 2;
      if (!rows.some((row) => cy > row.top && cy < row.bottom)) rows.push({ top: r.top, bottom: r.bottom });
    }
    return Math.max(1, rows.length);
  }

  function cleanSegments(segs) {
    // collapse whitespace across run boundaries and trim the ends
    const out = [];
    for (const s of segs) {
      if (!s.text) continue;
      const prev = out[out.length - 1];
      if (prev && /[ \n]$/.test(prev.text) && s.text.startsWith(' ')) s.text = s.text.slice(1);
      if (prev && s.text === '\n') prev.text = prev.text.replace(/ +$/, '');
      if (prev && prev.text.endsWith('\n')) s.text = s.text.replace(/^ +/, '');
      if (!s.text) continue;
      // merge identical styles
      if (prev && sameStyle(prev, s)) prev.text += s.text;
      else out.push({ ...s });
    }
    if (out.length) {
      out[0].text = out[0].text.replace(/^[ ]+/, '');
      out[out.length - 1].text = out[out.length - 1].text.replace(/[ \n]+$/, '');
    }
    return out.filter((s) => s.text.length);
  }

  function sameStyle(a, b) {
    return (
      a.family[0] === b.family[0] && a.weight === b.weight && a.italic === b.italic && a.size === b.size &&
      a.lineHeight === b.lineHeight && a.letterSpacing === b.letterSpacing && a.decoration === b.decoration &&
      a.transform === b.transform && a.color.r === b.color.r && a.color.g === b.color.g && a.color.b === b.color.b && a.color.a === b.color.a
    );
  }

  Extractor.prototype.textBounds = function (el) {
    const range = this.doc.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { box: this.rect(r), lines: countLines(range.getClientRects()) };
  };

  Extractor.prototype.makeText = function (el, segs, box, cs, lines) {
    return {
      id: 'n' + this.nextId++,
      kind: 'text',
      tag: el.tagName ? el.tagName.toUpperCase() : '#text',
      name: segs.map((s) => s.text).join('').replace(/\s+/g, ' ').slice(0, 48),
      box,
      s: { position: 'static', alignSelf: cs.alignSelf, grow: parseFloat(cs.flexGrow) || 0, textAlign: cs.textAlign, display: cs.display },
      text: { segments: segs, align: cs.textAlign, lines },
      children: [],
    };
  };

  Extractor.prototype.requestAsset = function (url, kindHint) {
    if (!url) return null;
    if (this.urlToAsset.has(url)) return this.urlToAsset.get(url);
    const id = 'a' + (this.urlToAsset.size + 1);
    this.urlToAsset.set(url, id);
    this.assetJobs.push(
      this.loadAsset(url)
        .then((a) => {
          if (a) this.assets[id] = a;
          else this.warnings.push('Could not load image (CORS?): ' + url.slice(0, 80));
        })
        .catch(() => this.warnings.push('Could not load image: ' + url.slice(0, 80)))
    );
    return id;
  };

  Extractor.prototype.loadAsset = async function (url) {
    const res = await fetch(url, { mode: 'cors' }).catch(() => null);
    let blob = res && res.ok ? await res.blob() : null;
    if (!blob) return null;
    const type = blob.type || '';
    if (/svg/.test(type) || /\.svg(\?|$)/i.test(url)) {
      return { kind: 'svg', svg: await blob.text() };
    }
    if (/^image\/(png|jpeg|gif)$/.test(type)) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      return { kind: 'image', mime: type, bytes: buf };
    }
    // webp / avif / unknown → re-encode as PNG
    try {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      const png = await new Promise((r) => c.toBlob(r, 'image/png'));
      return { kind: 'image', mime: 'image/png', bytes: new Uint8Array(await png.arrayBuffer()) };
    } catch (e) {
      return null;
    }
  };

  Extractor.prototype.svgMarkup = function (svg, box) {
    const clone = svg.cloneNode(true);
    const srcEls = [svg, ...svg.querySelectorAll('*')];
    const dstEls = [clone, ...clone.querySelectorAll('*')];
    srcEls.forEach((src, i) => {
      const dst = dstEls[i];
      if (!dst || !dst.setAttribute) return;
      const tag = (src.tagName || '').toLowerCase();
      const cs = this.cs(src);
      if (SVG_SHAPES.has(tag) || src === svg) {
        const fill = cs.fill;
        const stroke = cs.stroke;
        if (fill) dst.setAttribute('fill', fill.startsWith('url(') ? dst.getAttribute('fill') || fill : fill);
        if (stroke && stroke !== 'none') dst.setAttribute('stroke', stroke);
        if (cs.strokeWidth && stroke !== 'none') dst.setAttribute('stroke-width', cs.strokeWidth);
        if (cs.strokeLinecap && cs.strokeLinecap !== 'butt') dst.setAttribute('stroke-linecap', cs.strokeLinecap);
        if (cs.strokeLinejoin && cs.strokeLinejoin !== 'miter') dst.setAttribute('stroke-linejoin', cs.strokeLinejoin);
        if (cs.fillOpacity && cs.fillOpacity !== '1') dst.setAttribute('fill-opacity', cs.fillOpacity);
        if (cs.opacity && cs.opacity !== '1' && src !== svg) dst.setAttribute('opacity', cs.opacity);
      }
      dst.removeAttribute('class');
      dst.removeAttribute('style');
    });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(Math.round(box.w)));
    clone.setAttribute('height', String(Math.round(box.h)));
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${Math.round(box.w)} ${Math.round(box.h)}`);
    return new XMLSerializer().serializeToString(clone).replace(/currentColor/g, this.cs(svg).color);
  };

  /**
   * Is the element's width decided by its content (shrink-to-fit)?
   * Only asked where CSS makes it ambiguous: flex-row items, inline-blocks, floats,
   * absolutely positioned boxes and items of non-stretching flex columns.
   * Measured by temporarily forcing width:max-content. Returns true / false / undefined (not a candidate).
   */
  Extractor.prototype.measureShrink = function (el, cs) {
    const parent = el.parentElement;
    if (!parent || el === this.doc.body) return undefined;
    const pcs = this.cs(parent);
    const pFlex = /flex/.test(pcs.display);
    const rowItem = pFlex && !pcs.flexDirection.startsWith('column');
    const colItem = pFlex && pcs.flexDirection.startsWith('column') && !/stretch|normal/.test(cs.alignSelf === 'auto' ? pcs.alignItems : cs.alignSelf);
    const candidate = (rowItem && !(parseFloat(cs.flexGrow) > 0)) || colItem || /^inline-/.test(cs.display) || cs.float !== 'none' || cs.position === 'absolute' || cs.position === 'fixed';
    if (!candidate) return undefined;
    const before = el.getBoundingClientRect().width;
    const prevW = el.style.getPropertyValue('width'),
      prevP = el.style.getPropertyPriority('width');
    const prevMax = el.style.getPropertyValue('max-width'),
      prevMaxP = el.style.getPropertyPriority('max-width');
    const prevMin = el.style.getPropertyValue('min-width'),
      prevMinP = el.style.getPropertyPriority('min-width');
    el.style.setProperty('width', 'max-content', 'important');
    el.style.setProperty('max-width', 'none', 'important');
    el.style.setProperty('min-width', '0', 'important');
    const after = el.getBoundingClientRect().width;
    el.style.setProperty('width', prevW, prevP);
    el.style.setProperty('max-width', prevMax, prevMaxP);
    el.style.setProperty('min-width', prevMin, prevMinP);
    if (!el.getAttribute('style')) el.removeAttribute('style');
    return Math.abs(after - before) < 1;
  };

  /** Main recursive walk. Returns a raw node or null (or an array for display:contents). */
  Extractor.prototype.walk = function (el, depth) {
    if (el.nodeType !== 1) return null;
    const tag = el.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return null;
    const cs = this.cs(el);
    if (cs.display === 'none') return null;
    if (cs.display === 'contents') {
      const kids = [];
      for (const c of el.children) {
        const k = this.walk(c, depth);
        if (Array.isArray(k)) kids.push(...k);
        else if (k) kids.push(k);
      }
      return kids;
    }
    if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return null;
    if (el.getAttribute('aria-hidden') === 'true' && el.classList.contains('sr-only')) return null;
    const box = this.rect(el.getBoundingClientRect());
    const s = boxStyle(cs);
    // screen-reader-only / clipped content
    if (box.w <= 1 && box.h <= 1 && s.overflowHidden) return null;
    const base = { id: 'n' + this.nextId++, tag, name: layerName(el), box, s, children: [] };
    s.shrinkW = this.measureShrink(el, cs);

    // ---- SVG
    if (el instanceof this.win.SVGElement && tag === 'SVG') {
      if (box.w === 0 || box.h === 0) return null;
      return { ...base, kind: 'svg', svg: this.svgMarkup(el, box) };
    }
    if (el instanceof this.win.SVGElement) return null;

    // ---- images
    if (tag === 'IMG' || tag === 'PICTURE') {
      const img = tag === 'IMG' ? el : el.querySelector('img');
      if (!img || box.w === 0 || box.h === 0) return null;
      const src = img.currentSrc || img.src;
      return { ...base, kind: 'image', image: { asset: this.requestAsset(src), fit: this.cs(img).objectFit || 'fill' } };
    }
    if (tag === 'VIDEO' || tag === 'CANVAS' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'EMBED') {
      let asset = null;
      if (tag === 'VIDEO' && el.poster) asset = this.requestAsset(el.poster);
      if (tag === 'CANVAS') {
        try {
          asset = this.requestAsset(el.toDataURL('image/png'));
        } catch (e) {}
      }
      return { ...base, kind: 'image', image: { asset, fit: 'cover', placeholder: tag.toLowerCase() } };
    }
    if (tag === 'HR') {
      return { ...base, kind: 'frame', semantic: 'divider' };
    }

    // ---- form controls → frame + text
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'hidden') return null;
      base.semantic = type === 'checkbox' || type === 'radio' ? type : type === 'submit' || type === 'button' ? 'button' : 'input';
      base.kind = 'frame';
      // a control centres its value vertically inside an explicit height → flex row, counter-centred
      base.s = Object.assign({}, s, { display: 'flex', flexDir: 'row', flexWrap: 'nowrap', alignItems: tag === 'TEXTAREA' ? 'flex-start' : 'center', justify: base.semantic === 'button' || /center/.test(cs.textAlign) ? 'center' : 'flex-start' });
      if (type === 'checkbox' || type === 'radio') return base;
      let text = '',
        tcs = cs;
      if (tag === 'SELECT') text = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : '';
      else if (el.value) text = el.value;
      else if (el.placeholder) {
        text = el.placeholder;
        tcs = this.cs(el, '::placeholder');
      }
      if (text) {
        const st = textStyle(tcs);
        if (tcs !== cs) {
          // placeholder pseudo inherits font from the input
          const ist = textStyle(cs);
          Object.assign(st, { family: ist.family, size: ist.size, weight: tcs.fontWeight ? st.weight : ist.weight, lineHeight: ist.lineHeight });
        }
        const inner = {
          x: box.x + s.bw[3] + s.pad[3],
          y: box.y + s.bw[0] + s.pad[0],
          w: Math.max(1, box.w - s.bw[1] - s.bw[3] - s.pad[1] - s.pad[3]),
          h: Math.max(1, box.h - s.bw[0] - s.bw[2] - s.pad[0] - s.pad[2]),
        };
        const lh = st.lineHeight || st.size * 1.2;
        const tb = { x: inner.x, y: inner.y + (tag === 'TEXTAREA' ? 0 : Math.max(0, (inner.h - lh) / 2)), w: inner.w, h: Math.min(inner.h, lh) };
        const t = this.makeText(el, [{ text, ...st }], tb, cs, 1);
        t.s.fillWidth = true;
        base.children.push(t);
      }
      return base;
    }

    // ---- inline-only content → text (or frame wrapping text)
    const childNodes = [...el.childNodes].filter((n) => !(n.nodeType === 3 && !n.textContent.trim()) && n.nodeType !== 8);
    const allInline = childNodes.length > 0 && childNodes.every((n) => this.isInlineText(n));
    if (allInline && tag !== 'BODY') {
      const segs = cleanSegments(this.segments(el));
      if (!segs.length) {
        return hasVisualBox(s) ? { ...base, kind: 'frame' } : null;
      }
      const tb = this.textBounds(el);
      const visual = hasVisualBox(s) || s.pad.some((p) => p > 0) || tag === 'BUTTON';
      if (!visual && tag !== 'BUTTON') {
        // a bare text element: use the element box (keeps block width → FILL) and line count
        const t = this.makeText(el, segs, box, cs, tb.lines);
        t.name = segs.map((x) => x.text).join('').replace(/\s+/g, ' ').slice(0, 48);
        t.s.position = s.position;
        t.tagName = tag;
        t.textBox = tb.box;
        return t;
      }
      const t = this.makeText(el, segs, tb.box, cs, tb.lines);
      t.s.grow = 0; // flex-grow / align-self belong to the box, not to its label
      t.s.alignSelf = 'auto';
      base.kind = 'frame';
      base.children.push(t);
      if (!/flex/.test(s.display)) {
        // text inside a padded box: horizontal row, vertically centred (how buttons, badges and chips render)
        base.s = Object.assign({}, s, { display: 'flex', flexDir: 'row', flexWrap: 'nowrap', alignItems: tb.lines > 1 ? 'flex-start' : 'center', justify: /center/.test(cs.textAlign) ? 'center' : /right|end/.test(cs.textAlign) ? 'flex-end' : 'flex-start' });
        if (tb.lines > 1) t.s.fillWidth = true;
      }
      base.semantic = tag === 'BUTTON' || (tag === 'A' && (s.bg || s.bw.some((w) => w > 0))) ? 'button' : undefined;
      return base;
    }

    // ---- generic container
    base.kind = 'frame';
    if (tag === 'BUTTON') base.semantic = 'button';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        let t = node.textContent;
        if (!t.trim()) continue;
        const range = this.doc.createRange();
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const lines = countLines(range.getClientRects());
        t = /^pre/.test(cs.whiteSpace) ? t : t.replace(/\s+/g, ' ').trim();
        base.children.push(this.makeText(el, [{ text: t, ...textStyle(cs) }], this.rect(r), cs, lines));
        continue;
      }
      if (node.nodeType !== 1) continue;
      // inline formatting element sitting next to blocks (e.g. <strong> inside a flex container)
      const k = this.walk(node, depth + 1);
      if (Array.isArray(k)) base.children.push(...k);
      else if (k) base.children.push(k);
    }
    // order by z-index (stable) so later siblings paint above
    if (base.children.some((c) => c.s && c.s.zIndex)) {
      base.children = base.children
        .map((c, i) => [c, i])
        .sort((a, b) => (a[0].s.zIndex || 0) - (b[0].s.zIndex || 0) || a[1] - b[1])
        .map((x) => x[0]);
    }
    if (s.bgUrl) s.bgAsset = this.requestAsset(s.bgUrl);
    if (!base.children.length && !hasVisualBox(s) && (box.w === 0 || box.h === 0)) return null;
    return base;
  };

  /**
   * Extract a raw tree from a rendered document.
   * @returns {Promise<{root, assets, warnings, width, height}>}
   */
  /**
   * ::before / ::after cannot be measured, so in the (throw-away) render document we turn
   * every visible pseudo-element into a real <span> with the same computed style.
   */
  function materializePseudos(doc) {
    const win = doc.defaultView;
    const SKIP = new Set(['content', 'width', 'height', 'inline-size', 'block-size', 'min-inline-size', 'min-block-size', 'max-inline-size', 'max-block-size']);
    const jobs = [];
    for (const el of doc.body.querySelectorAll('*')) {
      if (SKIP_TAGS.has(el.tagName.toUpperCase()) || REPLACED.has(el.tagName.toUpperCase()) || el instanceof win.SVGElement) continue;
      for (const which of ['::before', '::after']) {
        const pcs = win.getComputedStyle(el, which);
        const content = pcs.content;
        if (!content || content === 'none' || content === 'normal' || pcs.display === 'none') continue;
        const m = content.match(/^(["'])(.*)\1$/s);
        if (!m) continue; // counters(), attr(), url() … are not materialised
        const text = m[2].replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, '$1');
        const visual = parseColor(pcs.backgroundColor) || pcs.backgroundImage !== 'none' || parseFloat(pcs.borderTopWidth) > 0 || parseFloat(pcs.borderBottomWidth) > 0 || parseFloat(pcs.borderLeftWidth) > 0 || pcs.boxShadow !== 'none';
        if (!text.trim() && !visual) continue;
        // icon fonts (private-use code points) would render as tofu in Figma
        if (/[\uE000-\uF8FF]/.test(text)) continue;
        const inline = pcs.display === 'inline';
        const decl = [];
        for (let i = 0; i < pcs.length; i++) {
          const prop = pcs[i];
          if (SKIP.has(prop) && (inline || prop === 'content')) continue;
          decl.push(`${prop}:${pcs.getPropertyValue(prop)}`);
        }
        jobs.push({ el, which, text, css: decl.join(';') });
      }
    }
    for (const j of jobs) {
      const span = doc.createElement('span');
      span.setAttribute('data-h2f-pseudo', j.which.slice(2));
      span.setAttribute('data-name', j.text.trim() ? j.text.trim().slice(0, 24) : j.which === '::before' ? 'Before' : 'After');
      span.style.cssText = j.css;
      span.textContent = j.text;
      if (j.which === '::before') j.el.insertBefore(span, j.el.firstChild);
      else j.el.appendChild(span);
      j.el.classList.add('h2f-nopseudo');
    }
    if (jobs.length) {
      const st = doc.createElement('style');
      st.textContent = '.h2f-nopseudo::before,.h2f-nopseudo::after{content:none!important;display:none!important}';
      doc.head.appendChild(st);
    }
    return jobs.length;
  }

  async function extract(doc, opts) {
    const ex = new Extractor(doc, opts);
    const win = doc.defaultView;
    if (!opts || opts.pseudo !== false) materializePseudos(doc);
    win.scrollTo(0, 0);
    const body = doc.body;
    const html = doc.documentElement;
    const width = opts && opts.width ? opts.width : html.clientWidth;
    const pageH = Math.max(body.scrollHeight, html.scrollHeight, body.getBoundingClientRect().height);
    const root = ex.walk(body, 0);
    const htmlBg = parseColor(win.getComputedStyle(html).backgroundColor);
    if (root) {
      root.box = { x: 0, y: 0, w: width, h: pageH };
      root.name = (opts && opts.name) || doc.title || 'Screen';
      root.isRoot = true;
      // body margin is real spacing in the page frame; body padding too.
      if (!root.s.bg) root.s.bg = htmlBg || { r: 1, g: 1, b: 1, a: 1 };
      root.s.bw = [0, 0, 0, 0];
      root.s.radius = [0, 0, 0, 0];
      root.s.shadows = [];
    }
    await Promise.all(ex.assetJobs);
    return { root, assets: ex.assets, warnings: ex.warnings, width, height: pageH };
  }

  /** Render an HTML string inside an off-screen iframe at the given size and extract it. */
  async function extractHTML(html, opts) {
    const { width, height, runScripts, baseUrl } = opts;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', runScripts ? 'allow-same-origin allow-scripts' : 'allow-same-origin');
    iframe.style.cssText = `position:fixed;left:-${width + 1000}px;top:0;width:${width}px;height:${height}px;border:0;visibility:hidden;pointer-events:none;`;
    let src = html;
    if (baseUrl && !/<base\s/i.test(src)) src = src.replace(/<head[^>]*>/i, (m) => `${m}<base href="${baseUrl}">`);
    if (!/<head/i.test(src)) src = `<!doctype html><html><head><meta charset="utf-8"></head><body>${src}</body></html>`;
    document.body.appendChild(iframe);
    try {
      await new Promise((resolve) => {
        iframe.onload = resolve;
        iframe.srcdoc = src;
        setTimeout(resolve, 8000);
      });
      const doc = iframe.contentDocument;
      if (!doc) throw new Error('Cannot access rendered document');
      try {
        await doc.fonts.ready;
      } catch (e) {}
      // wait for images
      await Promise.all(
        [...doc.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 5000); })))
      );
      await new Promise((r) => setTimeout(r, opts.settleMs || 120));
      return await extract(doc, opts);
    } finally {
      if (!opts.keepFrame) iframe.remove();
    }
  }

  H2F.extract = extract;
  H2F.extractHTML = extractHTML;
  H2F._extractInternals = { parseColor, parseShadows, parseGradient, splitTop, layerName, humanize };
})(typeof globalThis !== 'undefined' ? globalThis : this);
