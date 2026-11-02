/*
 * H2F core — layout.js
 * Raw tree (boxes + computed styles) → design tree (Figma-shaped):
 *   - infers auto layout direction, gap, padding, alignment, wrap
 *   - decides HUG / FILL / FIXED sizing per axis
 *   - groups irregularly-spaced siblings so every stack has ONE consistent gap
 *   - snaps spacing / radius / sizes / type to the 4pt or 8pt grid
 * Pure: no DOM, runs in Node for tests.
 */
(function (root) {
  const H2F = (root.H2F = root.H2F || {});
  const G = () => H2F.grid;

  const TOL = 1.5; // px tolerance for "touching" comparisons
  const HUG_SLACK = 32; // free space allowed at the end of a stack before we call it fixed-size

  function emptyStyle() {
    return {
      display: 'block', position: 'static', flexDir: 'row', flexWrap: 'nowrap', justify: 'normal', alignItems: 'normal',
      alignSelf: 'auto', grow: 0, rowGap: 0, colGap: 0, pad: [0, 0, 0, 0], bw: [0, 0, 0, 0], bc: [null, null, null, null],
      radius: [0, 0, 0, 0], bg: null, gradients: [], shadows: [], opacity: 1, overflowHidden: false, textAlign: 'start', zIndex: 0,
    };
  }

  const isAbs = (n) => n.s && (n.s.position === 'absolute' || n.s.position === 'fixed');
  const right = (b) => b.x + b.w;
  const bottom = (b) => b.y + b.h;

  function union(nodes) {
    const x = Math.min(...nodes.map((n) => n.box.x));
    const y = Math.min(...nodes.map((n) => n.box.y));
    const r = Math.max(...nodes.map((n) => right(n.box)));
    const b = Math.max(...nodes.map((n) => bottom(n.box)));
    return { x, y, w: r - x, h: b - y };
  }

  function median(arr) {
    if (!arr.length) return 0;
    const a = [...arr].sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
  }

  /** Most common value after snapping (ties → smaller). */
  function modeSnapped(arr, rules) {
    if (!arr.length) return 0;
    const counts = new Map();
    for (const v of arr) {
      const k = rules.snapSpacing ? G().snapSpace(Math.max(0, v), rules) : Math.round(Math.max(0, v));
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let best = null,
      bc = -1;
    for (const [k, c] of counts) if (c > bc || (c === bc && k < best)) (best = k), (bc = c);
    return best;
  }

  // ------------------------------------------------------------ geometry tests
  function stackedV(list) {
    const a = [...list].sort((p, q) => p.box.y - q.box.y);
    for (let i = 1; i < a.length; i++) if (a[i].box.y < bottom(a[i - 1].box) - TOL) return null;
    return a;
  }

  function rowH(list) {
    const a = [...list].sort((p, q) => p.box.x - q.box.x);
    for (let i = 1; i < a.length; i++) if (a[i].box.x < right(a[i - 1].box) - TOL) return null;
    const top = Math.max(...a.map((n) => n.box.y));
    const bot = Math.min(...a.map((n) => bottom(n.box)));
    if (top > bot + TOL) return null; // not on one line
    return a;
  }

  /** Rows of items (flex-wrap / grid). Returns array of rows or null. */
  function wrapRows(list) {
    const a = [...list].sort((p, q) => p.box.y - q.box.y || p.box.x - q.box.x);
    const rows = [];
    for (const n of a) {
      const row = rows.find((r) => n.box.y < r.bottom - TOL && bottom(n.box) > r.top + TOL);
      if (row) {
        row.items.push(n);
        row.top = Math.min(row.top, n.box.y);
        row.bottom = Math.max(row.bottom, bottom(n.box));
      } else rows.push({ items: [n], top: n.box.y, bottom: bottom(n.box) });
    }
    rows.sort((p, q) => p.top - q.top);
    for (let i = 1; i < rows.length; i++) if (rows[i].top < rows[i - 1].bottom - TOL) return null;
    for (const r of rows) {
      r.items.sort((p, q) => p.box.x - q.box.x);
      for (let i = 1; i < r.items.length; i++) if (r.items[i].box.x < right(r.items[i - 1].box) - TOL) return null;
    }
    return rows;
  }

  // ------------------------------------------------------------ irregular gap grouping
  /**
   * Siblings in a stack must share one gap in Figma. When CSS margins produce
   * irregular gaps (e.g. 8, 24, 24), group the tightly-spaced runs into nested
   * auto-layout groups so the outer stack gets a single consistent gap.
   */
  function groupIrregular(ordered, axis, rules, report) {
    const gapOf = (a, b) => (axis === 'V' ? b.box.y - bottom(a.box) : b.box.x - right(a.box));
    let items = ordered;
    for (let iter = 0; iter < 3 && items.length > 2; iter++) {
      const gaps = [];
      for (let i = 1; i < items.length; i++) gaps.push(Math.max(0, gapOf(items[i - 1], items[i])));
      const snapped = gaps.map((g) => G().snapSpace(g, rules));
      const uniq = [...new Set(snapped)];
      if (uniq.length <= 1) break;
      const min = Math.min(...snapped);
      // only group when the small gap is clearly tighter than the rest
      const others = snapped.filter((g) => g !== min);
      if (!others.length || Math.min(...others) - min < 8) break;
      const out = [];
      let run = [items[0]];
      for (let i = 1; i < items.length; i++) {
        if (snapped[i - 1] === min) run.push(items[i]);
        else {
          out.push(run);
          run = [items[i]];
        }
      }
      out.push(run);
      if (out.length === items.length || out.length === 1) break;
      items = out.map((r) => {
        if (r.length === 1) return r[0];
        report.grouped++;
        return {
          id: r[0].id + '_g',
          kind: 'frame',
          tag: 'GROUP',
          name: groupName(r),
          synthetic: true,
          box: union(r),
          s: Object.assign(emptyStyle(), { display: 'block', flexDir: axis === 'V' ? 'column' : 'row' }),
          children: r,
        };
      });
    }
    return items;
  }

  function groupName(items) {
    const first = items[0];
    if (first.kind === 'text' && /^H[1-6]$/.test(first.tagName || first.tag)) return 'Heading group';
    if (items.every((i) => i.kind === 'text')) return 'Text group';
    return 'Group';
  }

  // ------------------------------------------------------------ paints
  function solid(c) {
    return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a === undefined ? 1 : c.a };
  }

  function fillsFor(s) {
    const fills = [];
    if (s.bg) fills.push(solid(s.bg));
    for (const g of [...(s.gradients || [])].reverse()) {
      fills.push({
        type: g.type === 'radial' ? 'GRADIENT_RADIAL' : 'GRADIENT_LINEAR',
        angle: g.angle,
        stops: g.stops.map((st) => ({ position: Math.max(0, Math.min(1, st.pos)), color: { r: st.color.r, g: st.color.g, b: st.color.b, a: st.color.a } })),
      });
    }
    if (s.bgAsset) {
      fills.push({ type: 'IMAGE', asset: s.bgAsset, scaleMode: s.bgSize === 'contain' ? 'FIT' : 'FILL' });
    }
    return fills;
  }

  function strokesFor(s) {
    if (!s.bw || !s.bw.some((w) => w > 0)) return null;
    const idx = s.bw.findIndex((w) => w > 0);
    const color = s.bc[idx];
    if (!color) return null;
    const uniform = s.bw.every((w) => Math.abs(w - s.bw[idx]) < 0.01);
    return {
      paints: [solid(color)],
      weight: s.bw[idx],
      weights: uniform ? null : s.bw.slice(),
      align: 'INSIDE',
      dashed: s.bstyle === 'dashed' ? [Math.max(2, s.bw[idx] * 3), Math.max(2, s.bw[idx] * 2)] : s.bstyle === 'dotted' ? [s.bw[idx], s.bw[idx]] : null,
    };
  }

  function effectsFor(s) {
    const fx = [];
    for (const sh of s.shadows || []) {
      fx.push({
        type: sh.inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
        color: { r: sh.color.r, g: sh.color.g, b: sh.color.b, a: sh.color.a },
        offset: { x: Math.round(sh.x), y: Math.round(sh.y) },
        radius: Math.round(sh.blur),
        spread: Math.round(sh.spread),
        visible: true,
        blendMode: 'NORMAL',
      });
    }
    if (s.blur) fx.push({ type: 'LAYER_BLUR', radius: Math.round(s.blur), visible: true });
    if (s.backdropBlur) fx.push({ type: 'BACKGROUND_BLUR', radius: Math.round(s.backdropBlur), visible: true });
    return fx;
  }

  // ------------------------------------------------------------ main converter
  function Layout(rules, opts) {
    this.rules = Object.assign({}, G().DEFAULT_RULES, rules || {});
    this.opts = Object.assign({ autoLayout: true }, opts || {});
    this.report = { snapped: { spacing: 0, radius: 0, size: 0, type: 0 }, grouped: 0, absolute: 0, autoLayoutFrames: 0, frames: 0, texts: 0, images: 0, examples: [] };
  }

  Layout.prototype.note = function (kind, from, to) {
    if (Math.abs(from - to) < 0.5) return;
    this.report.snapped[kind]++;
    if (this.report.examples.length < 12) this.report.examples.push(`${kind} ${G().r2(from)} → ${to}`);
  };

  Layout.prototype.space = function (v) {
    if (!this.rules.snapSpacing) return Math.max(0, Math.round(v));
    const out = G().snapSpace(Math.max(0, v), this.rules);
    this.note('spacing', v, out);
    return out;
  };

  Layout.prototype.size = function (v) {
    if (!this.rules.snapSizes) return Math.max(1, Math.round(v));
    const out = G().snapSize(v, this.rules);
    this.note('size', v, out);
    return out;
  };

  Layout.prototype.pos = function (v) {
    if (!this.rules.snapSizes) return Math.round(v);
    return Math.round(v / 4) * 4;
  };

  Layout.prototype.radius = function (rad, w, h) {
    return rad.map((v) => {
      if (!v) return 0;
      if (!this.rules.snapRadius) return Math.round(v);
      const out = G().snapRadius(v, w, h, this.rules);
      if (out !== G().PILL) this.note('radius', v, out);
      return out;
    });
  };

  /**
   * Decide auto layout for a frame from its in-flow children.
   * Returns { mode, wrap, ordered, rows, primary, counter, isFlex }.
   */
  Layout.prototype.direction = function (node, flow) {
    const s = node.s;
    const isFlex = /flex/.test(s.display);
    const isGrid = /grid/.test(s.display);
    if (!flow.length) return { mode: 'NONE' };
    if (flow.length === 1) {
      const mode = isFlex && !s.flexDir.startsWith('column') ? 'HORIZONTAL' : 'VERTICAL';
      return { mode, ordered: flow, isFlex };
    }
    if (isFlex) {
      const col = s.flexDir.startsWith('column');
      if (s.flexWrap !== 'nowrap' && !col) {
        const rows = wrapRows(flow);
        if (rows && rows.length > 1) return { mode: 'HORIZONTAL', wrap: true, rows, ordered: rows.flatMap((r) => r.items), isFlex };
      }
      const ordered = col ? stackedV(flow) : rowH(flow);
      if (ordered) return { mode: col ? 'VERTICAL' : 'HORIZONTAL', ordered, isFlex };
    }
    const v = stackedV(flow);
    if (v && !(isGrid && rowH(flow))) return { mode: 'VERTICAL', ordered: v, isFlex: false };
    const h = rowH(flow);
    if (h) return { mode: 'HORIZONTAL', ordered: h, isFlex: isFlex };
    const rows = wrapRows(flow);
    if (rows && rows.length > 1 && rows.every((r) => r.items.length >= 1)) {
      return { mode: 'HORIZONTAL', wrap: true, rows, ordered: rows.flatMap((r) => r.items), isFlex };
    }
    return { mode: 'NONE' };
  };

  Layout.prototype.convertNode = function (node, parentBox, ctx) {
    // ctx: { fillH, fillV, maxW, inAutoLayout, absolute }
    ctx = ctx || {};
    const relX = node.box.x - (parentBox ? parentBox.x : 0);
    const relY = node.box.y - (parentBox ? parentBox.y : 0);
    const s = node.s || emptyStyle();
    const out = {
      id: node.id,
      name: node.name || 'Frame',
      x: this.pos(relX),
      y: this.pos(relY),
      width: Math.max(1, node.box.w),
      height: Math.max(1, node.box.h),
      absolute: !!ctx.absolute,
      opacity: s.opacity === undefined || isNaN(s.opacity) ? 1 : s.opacity,
      semantic: node.semantic,
      tag: node.tag,
    };

    if (node.kind === 'text') return this.convertText(node, out, ctx);
    if (node.kind === 'image') {
      this.report.images++;
      out.type = 'IMAGE';
      out.image = { asset: node.image.asset, scaleMode: node.image.fit === 'contain' ? 'FIT' : 'FILL', placeholder: node.image.placeholder };
      out.radius = this.radius(s.radius || [0, 0, 0, 0], node.box.w, node.box.h);
      out.strokes = strokesFor(s);
      out.effects = effectsFor(s);
      return this.finishSizing(out, ctx, false, false);
    }
    if (node.kind === 'svg') {
      this.report.images++;
      out.type = 'SVG';
      out.svg = node.svg;
      return this.finishSizing(out, ctx, false, false);
    }

    // ---- frame
    this.report.frames++;
    out.type = 'FRAME';
    out.fills = fillsFor(s);
    out.strokes = strokesFor(s);
    out.effects = effectsFor(s);
    out.radius = this.radius(s.radius || [0, 0, 0, 0], node.box.w, node.box.h);
    out.clip = !!s.overflowHidden || !!node.isRoot;
    out.children = [];

    const kids = node.children || [];
    const flow = kids.filter((k) => !isAbs(k));
    const abs = kids.filter(isAbs);
    let dir = this.opts.autoLayout ? this.direction(node, flow) : { mode: 'NONE' };

    if (dir.mode === 'NONE') {
      out.layout = { mode: 'NONE' };
      for (const k of kids) out.children.push(this.convertNode(k, node.box, { absolute: false }));
      return this.finishSizing(out, ctx, false, false);
    }

    this.report.autoLayoutFrames++;
    const V = dir.mode === 'VERTICAL';
    const b = node.box;
    const bw = s.bw || [0, 0, 0, 0];
    const pad = s.pad || [0, 0, 0, 0];
    const css = [pad[0] + bw[0], pad[1] + bw[1], pad[2] + bw[2], pad[3] + bw[3]]; // t r b l
    const content = { x: b.x + css[3], y: b.y + css[0], w: b.w - css[1] - css[3], h: b.h - css[0] - css[2] };

    // irregular gaps → nested groups (block flow only; flex gaps are uniform by construction unless margins)
    let ordered = dir.ordered;
    if (!dir.wrap && ordered.length > 2 && !(dir.isFlex && /space-/.test(s.justify))) {
      ordered = groupIrregular(ordered, V ? 'V' : 'H', this.rules, this.report);
    }

    // ---- primary axis alignment
    let primary = 'MIN';
    let pushApart = false;
    if (ordered !== dir.ordered && ordered.length === 2) {
      const a = ordered[0].box,
        c = ordered[1].box;
      const between = V ? c.y - bottom(a) : c.x - right(a);
      if (between >= 64) pushApart = true;
    }
    if (dir.isFlex) {
      const j = s.justify;
      if (/space-(between|around|evenly)/.test(j) && ordered.length > 1) primary = 'SPACE_BETWEEN';
      else if (/center/.test(j)) primary = 'CENTER';
      else if (/(flex-)?end|right/.test(j)) primary = 'MAX';
    } else if (!V && /center/.test(s.textAlign)) primary = 'CENTER';
    else if (!V && /right|end/.test(s.textAlign)) primary = 'MAX';
    if (pushApart) primary = 'SPACE_BETWEEN';

    // ---- gaps
    let gap = 0,
      crossGap = 0;
    if (dir.wrap) {
      const inRow = [];
      for (const r of dir.rows) for (let i = 1; i < r.items.length; i++) inRow.push(r.items[i].box.x - right(r.items[i - 1].box));
      const between = [];
      for (let i = 1; i < dir.rows.length; i++) between.push(dir.rows[i].top - dir.rows[i - 1].bottom);
      gap = inRow.length ? modeSnapped(inRow, this.rules) : this.space(s.colGap);
      crossGap = between.length ? modeSnapped(between, this.rules) : this.space(s.rowGap);
    } else if (ordered.length > 1) {
      const gaps = [];
      for (let i = 1; i < ordered.length; i++) {
        const a = ordered[i - 1].box,
          c = ordered[i].box;
        gaps.push(V ? c.y - bottom(a) : c.x - right(a));
      }
      gap = modeSnapped(gaps, this.rules);
      if (Math.max(...gaps) - Math.min(...gaps) > 4) this.report.irregular = (this.report.irregular || 0) + 1;
    }

    // ---- padding (measured on the primary axis, CSS on the cross axis)
    const first = ordered[0].box,
      last = ordered[ordered.length - 1].box;
    const ext = union(ordered);
    let padT, padR, padB, padL;
    let hugMain;
    // main axis: start slack / end slack decide padding and whether the frame hugs its content
    const startSlack = V ? first.y - b.y : first.x - b.x;
    const endSlack = V ? bottom(b) - bottom(last) : right(b) - right(last);
    const cssStart = V ? css[0] : css[3];
    const cssEnd = V ? css[2] : css[1];
    let mainStart = cssStart,
      mainEnd = cssEnd;
    if (primary === 'MIN') {
      mainStart = startSlack;
      hugMain = endSlack <= cssEnd + HUG_SLACK;
      mainEnd = hugMain ? endSlack : cssEnd;
    } else if (primary === 'CENTER') {
      // an explicitly sized box (measured, not shrink-to-fit) keeps CSS padding and a fixed width
      hugMain = Math.abs(endSlack - startSlack) < 2 && endSlack <= cssEnd + HUG_SLACK && !(!V && s.shrinkW === false);
      if (hugMain) mainStart = mainEnd = Math.min(startSlack, endSlack);
    } else hugMain = false;
    if (dir.wrap) {
      mainStart = startSlack;
      mainEnd = cssEnd;
      hugMain = false;
    }
    if (V) {
      padT = mainStart;
      padB = mainEnd;
      padL = Math.min(css[3], ext.x - b.x);
      padR = Math.min(css[1], right(b) - right(ext));
    } else {
      padL = mainStart;
      padR = mainEnd;
      padT = dir.wrap ? first.y - b.y : Math.min(css[0], ext.y - b.y);
      padB = Math.min(css[2], bottom(b) - bottom(ext));
    }
    padT = Math.max(0, padT);
    padR = Math.max(0, padR);
    padB = Math.max(0, padB);
    padL = Math.max(0, padL);

    // ---- cross axis alignment + which children fill the cross axis
    const cx0 = V ? b.x + padL : b.y + padT;
    const cx1 = V ? right(b) - padR : bottom(b) - padB;
    const offs = ordered.map((k) => {
      const lo = (V ? k.box.x : k.box.y) - cx0;
      const hi = cx1 - (V ? right(k.box) : bottom(k.box));
      return { lo, hi };
    });
    // block text with side margins (e.g. <p style="margin:0 14px"> next to a full-bleed image):
    // Figma has no per-child margins, so wrap it in a frame whose padding is the margin.
    if (V && !dir.isFlex && !dir.wrap && ordered.length > 1) {
      ordered = ordered.map((k, i) => {
        const o = offs[i];
        if (k.kind !== 'text' || o.lo <= TOL || o.hi <= TOL || /center/.test((k.text && k.text.align) || '')) return k;
        if (!/^(P|H[1-6]|LI|BLOCKQUOTE|DIV|FIGCAPTION|DT|DD|LABEL)$/.test(k.tagName || k.tag)) return k;
        offs[i] = { lo: 0, hi: 0 };
        this.report.grouped++;
        return {
          id: k.id + '_m',
          kind: 'frame',
          tag: 'GROUP',
          name: (k.tagName === 'P' ? 'Paragraph' : 'Text') + ' container',
          synthetic: true,
          box: { x: cx0, y: k.box.y, w: cx1 - cx0, h: k.box.h },
          s: Object.assign(emptyStyle(), { pad: [0, o.hi, 0, o.lo] }),
          children: [Object.assign({}, k, { s: Object.assign({}, k.s, { fillWidth: true }) })],
        };
      });
    }
    let counter = 'MIN';
    if (dir.isFlex) {
      const ai = s.alignItems;
      if (/center/.test(ai)) counter = 'CENTER';
      else if (/(flex-)?end/.test(ai)) counter = 'MAX';
      else if (/baseline/.test(ai) && !V) counter = 'BASELINE';
    } else if (!dir.wrap) {
      const allMin = offs.every((o) => Math.abs(o.lo) <= TOL);
      const allMax = offs.every((o) => Math.abs(o.hi) <= TOL);
      const allCenter = offs.every((o) => Math.abs(o.lo - o.hi) <= 2);
      if (!allMin && allCenter) counter = 'CENTER';
      else if (!allMin && allMax) counter = 'MAX';
      else if (!allMin) {
        // shared extra indent → fold into padding
        const minLo = Math.min(...offs.map((o) => o.lo));
        if (minLo > TOL) {
          if (V) padL += minLo;
          else padT += minLo;
          offs.forEach((o) => (o.lo -= minLo));
        }
      }
    }
    if (dir.wrap && /center/.test(s.justify)) primary = 'CENTER';

    const stretchCross = dir.isFlex ? /stretch|normal/.test(s.alignItems) : true;

    out.layout = {
      mode: dir.mode,
      wrap: !!dir.wrap,
      padding: [this.space(padT), this.space(padR), this.space(padB), this.space(padL)],
      gap: gap,
      crossGap: crossGap,
      primary,
      counter,
    };
    if (primary === 'SPACE_BETWEEN') out.layout.gap = 0;

    // ---- children
    let anyFillH = false,
      anyFillV = false;
    ordered.forEach((k, i) => {
      const o = offs[i];
      const spansCross = Math.abs(o.lo) <= TOL && Math.abs(o.hi) <= TOL;
      const kctx = { inAutoLayout: true };
      const grow = k.s && k.s.grow > 0;
      if (dir.wrap) {
        // fixed tiles
      } else if (V) {
        kctx.fillH = spansCross && stretchCross && s.shrinkW !== true;
        kctx.fillV = dir.isFlex && grow;
        // centred block with max-width → FILL + maxWidth (exact CSS semantics)
        if (!kctx.fillH && counter === 'CENTER' && !dir.isFlex && k.kind !== 'text' && k.box.w >= (cx1 - cx0) * 0.5) {
          kctx.fillH = true;
          kctx.maxW = k.box.w;
        }
        if (k.kind === 'text' && k.s && k.s.fillWidth) kctx.fillH = true;
      } else {
        kctx.fillH = dir.isFlex && grow;
        kctx.fillV = spansCross && dir.isFlex && stretchCross && ordered.length > 1 && k.kind !== 'text';
        if (k.kind === 'text' && k.s && k.s.fillWidth) kctx.fillH = true;
      }
      anyFillH = anyFillH || kctx.fillH;
      anyFillV = anyFillV || kctx.fillV;
      out.children.push(this.convertNode(k, b, kctx));
    });
    for (const k of abs) {
      this.report.absolute++;
      out.children.push(this.convertNode(k, b, { absolute: true }));
    }

    // ---- own HUG decision
    let hugW, hugH;
    const kidsExtentCross = V ? Math.max(...ordered.map((k) => k.box.w)) : Math.max(...ordered.map((k) => k.box.h));
    const crossSize = V ? b.w : b.h;
    const crossPads = V ? padL + padR : padT + padB;
    const hugCross = Math.abs(kidsExtentCross + crossPads - crossSize) <= 2;
    if (V) {
      hugH = hugMain && !anyFillV;
      hugW = hugCross && !anyFillH;
    } else {
      hugW = hugMain && !anyFillH && !dir.wrap;
      hugH = (hugCross || dir.wrap) && !anyFillV;
    }
    if (s.shrinkW === true && !anyFillH && !dir.wrap) hugW = true;
    if (s.shrinkW === false) hugW = false;
    out._hasFillKids = { h: anyFillH, v: anyFillV };
    return this.finishSizing(out, ctx, hugW, hugH);
  };

  Layout.prototype.convertText = function (node, out, ctx) {
    this.report.texts++;
    out.type = 'TEXT';
    const segs = node.text.segments.map((sg) => {
      let size = sg.size;
      if (this.rules.snapType) {
        const sn = G().snapFontSize(size);
        this.note('type', size, sn);
        size = sn;
      }
      let lh = sg.lineHeight;
      if (lh && this.rules.snapType) {
        const ratio = lh / sg.size;
        const target = G().snapLineHeight(size * ratio);
        this.note('type', lh, target);
        lh = target;
      }
      return {
        text: sg.text,
        family: sg.family,
        weight: sg.weight,
        italic: sg.italic,
        size,
        lineHeight: lh,
        letterSpacing: Math.round((sg.letterSpacing || 0) * 10) / 10,
        color: sg.color,
        decoration: sg.decoration,
        textCase: sg.transform,
      };
    });
    const align = node.text.align || 'start';
    out.text = {
      segments: segs,
      align: /center/.test(align) ? 'CENTER' : /right|end/.test(align) ? 'RIGHT' : /justify/.test(align) ? 'JUSTIFIED' : 'LEFT',
      lines: node.text.lines || 1,
    };
    // auto-resize behaviour
    if (ctx.fillH) out.text.autoResize = 'HEIGHT';
    else if ((node.text.lines || 1) <= 1) {
      out.text.autoResize = 'WIDTH_AND_HEIGHT';
      // a block-level single-line text that is wider than its glyphs keeps its width when not in auto layout
      if (!ctx.inAutoLayout && node.textBox && node.box.w - node.textBox.w > 4) out.text.autoResize = 'HEIGHT';
    } else out.text.autoResize = 'HEIGHT';
    if (out.text.autoResize === 'WIDTH_AND_HEIGHT' && node.textBox && /center|right|end/.test(align) && !ctx.inAutoLayout) {
      out.text.autoResize = 'HEIGHT';
    }
    const hugW = out.text.autoResize === 'WIDTH_AND_HEIGHT';
    return this.finishSizing(out, ctx, hugW, true);
  };

  Layout.prototype.finishSizing = function (out, ctx, hugW, hugH) {
    const auto = out.layout && out.layout.mode && out.layout.mode !== 'NONE';
    const isText = out.type === 'TEXT';
    const canHug = auto || isText;
    out.sizingH = ctx.fillH && ctx.inAutoLayout ? 'FILL' : hugW && canHug ? 'HUG' : 'FIXED';
    out.sizingV = ctx.fillV && ctx.inAutoLayout ? 'FILL' : hugH && canHug ? 'HUG' : 'FIXED';
    if (ctx.maxW && out.sizingH === 'FILL') out.maxWidth = this.size(ctx.maxW);
    if (out.sizingH === 'FIXED' && !isText) out.width = this.size(out.width);
    else out.width = Math.max(1, Math.round(out.width));
    if (out.sizingV === 'FIXED' && !isText) out.height = this.size(out.height);
    else out.height = Math.max(1, Math.round(out.height));
    if (isText && out.sizingH === 'FIXED') out.width = Math.ceil(out.width + 1); // avoid unexpected wrapping from font metric drift
    delete out._hasFillKids;
    return out;
  };

  /**
   * raw extraction result → design document (before components/tokens)
   */
  function layout(extracted, rules, opts) {
    const L = new Layout(rules, opts);
    const raw = extracted.root;
    const screen = (opts && opts.screen) || { width: extracted.width, height: extracted.height };
    const rootOut = L.convertNode(raw, null, {});
    rootOut.x = 0;
    rootOut.y = 0;
    rootOut.width = screen.width;
    rootOut.sizingH = 'FIXED';
    rootOut.isScreen = true;
    if (rootOut.layout && rootOut.layout.mode === 'VERTICAL') {
      rootOut.sizingV = 'HUG';
      rootOut.minHeight = screen.height;
      rootOut.height = Math.max(screen.height, Math.round(raw.box.h));
    } else {
      rootOut.sizingV = 'FIXED';
      rootOut.height = Math.max(screen.height, L.size(raw.box.h));
    }
    return { root: rootOut, report: L.report };
  }

  H2F.layout = layout;
  H2F._layoutInternals = { stackedV, rowH, wrapRows, groupIrregular, modeSnapped, union, emptyStyle, fillsFor, strokesFor, effectsFor };
})(typeof globalThis !== 'undefined' ? globalThis : this);
