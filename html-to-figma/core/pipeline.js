/*
 * H2F core — pipeline.js
 * Glue: HTML → extract → layout → components → tokens → H2F document.
 * Also: screen presets, JSON (de)serialisation and a design-rule audit.
 *
 * H2F document (format "h2f", version 1) — the contract between the website,
 * the plugin UI and the plugin main thread:
 *   { format, version, meta:{name, screen:{width,height,label}, rules, source},
 *     root: DesignNode, components:{key:{name,family,variant,set,textProps}},
 *     tokens:{colors,text,spacing,radius}, assets:{id:{kind,mime,bytes|svg}}, report }
 */
(function (root) {
  const H2F = (root.H2F = root.H2F || {});

  H2F.VERSION = '1.0.0';

  H2F.SCREENS = [
    { id: 'iphone-16', label: 'iPhone 16 / 15', group: 'Mobile', width: 393, height: 852 },
    { id: 'iphone-se', label: 'iPhone SE', group: 'Mobile', width: 375, height: 667 },
    { id: 'iphone-pro-max', label: 'iPhone 16 Pro Max', group: 'Mobile', width: 440, height: 956 },
    { id: 'android', label: 'Android (Compact)', group: 'Mobile', width: 360, height: 800 },
    { id: 'android-m', label: 'Android (Medium)', group: 'Mobile', width: 412, height: 917 },
    { id: 'ipad-mini', label: 'iPad mini', group: 'Tablet', width: 744, height: 1133 },
    { id: 'ipad', label: 'iPad Pro 11"', group: 'Tablet', width: 834, height: 1194 },
    { id: 'laptop', label: 'Laptop', group: 'Desktop', width: 1280, height: 832 },
    { id: 'desktop', label: 'Desktop', group: 'Desktop', width: 1440, height: 1024 },
    { id: 'desktop-hd', label: 'Desktop HD', group: 'Desktop', width: 1920, height: 1080 },
  ];

  function buildDoc(extracted, opts) {
    opts = opts || {};
    const rules = Object.assign({}, H2F.grid.DEFAULT_RULES, opts.rules || {});
    const screen = opts.screen || { width: extracted.width, height: extracted.height };
    const { root: tree, report } = H2F.layout(extracted, rules, { autoLayout: opts.autoLayout !== false, screen });
    tree.name = opts.name || tree.name || 'Screen';
    const doc = {
      format: 'h2f',
      version: 1,
      meta: { name: tree.name, screen, rules, source: opts.source || 'html', generator: 'html-to-figma ' + H2F.VERSION },
      root: tree,
      components: {},
      tokens: { colors: [], text: [], spacing: [], radius: [] },
      assets: extracted.assets || {},
      report: Object.assign(report, { warnings: extracted.warnings || [] }),
    };
    if (opts.components !== false) H2F.detectComponents(doc);
    H2F.collectTokens(doc);
    doc.report.components = Object.keys(doc.components).length;
    doc.report.audit = audit(doc);
    return doc;
  }

  async function convertHTML(html, opts) {
    const screen = opts.screen;
    const extracted = await H2F.extractHTML(html, {
      width: screen.width,
      height: screen.height,
      runScripts: !!opts.runScripts,
      baseUrl: opts.baseUrl,
      name: opts.name,
    });
    if (!extracted.root) throw new Error('Nothing visible was found in that HTML.');
    return buildDoc(extracted, opts);
  }

  // ------------------------------------------------------------ audit
  /** Checks the finished tree against the grid rules. Returns {checked, violations[], score}. */
  function audit(doc) {
    const base = doc.meta.rules.base || 8;
    const ok = (v) => v === 0 || v % 4 === 0 && (base === 4 || v < 16 || v % 8 === 0) || v >= H2F.grid.PILL;
    let checked = 0;
    const violations = [];
    (function walk(n, path) {
      const p = path + '/' + n.name;
      if (n.layout && n.layout.mode !== 'NONE' && n.layout.mode) {
        n.layout.padding.forEach((v, i) => {
          checked++;
          if (!ok(v)) violations.push({ path: p, prop: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'][i], value: v });
        });
        checked++;
        if (!ok(n.layout.gap)) violations.push({ path: p, prop: 'gap', value: n.layout.gap });
        if (n.layout.wrap) {
          checked++;
          if (!ok(n.layout.crossGap)) violations.push({ path: p, prop: 'rowGap', value: n.layout.crossGap });
        }
      }
      (n.radius || []).forEach((v) => {
        checked++;
        if (!ok(v)) violations.push({ path: p, prop: 'radius', value: v });
      });
      for (const c of n.children || []) walk(c, p);
    })(doc.root, '');
    return { checked, violations: violations.slice(0, 200), violationCount: violations.length, score: checked ? Math.round((100 * (checked - violations.length)) / checked) : 100 };
  }

  // ------------------------------------------------------------ (de)serialisation
  function b64encode(bytes) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return typeof btoa !== 'undefined' ? btoa(s) : Buffer.from(bytes).toString('base64');
  }

  function b64decode(str) {
    if (typeof atob === 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function serialize(doc, pretty) {
    const assets = {};
    for (const [k, a] of Object.entries(doc.assets || {})) {
      assets[k] = a.bytes ? { kind: a.kind, mime: a.mime, b64: b64encode(a.bytes) } : a;
    }
    return JSON.stringify(Object.assign({}, doc, { assets }), null, pretty ? 2 : 0);
  }

  function deserialize(str) {
    const doc = typeof str === 'string' ? JSON.parse(str) : str;
    if (!doc || doc.format !== 'h2f') throw new Error('Not an html-to-figma (.h2f.json) document');
    for (const a of Object.values(doc.assets || {})) {
      if (a.b64) {
        a.bytes = b64decode(a.b64);
        delete a.b64;
      }
    }
    return doc;
  }

  H2F.buildDoc = buildDoc;
  H2F.convertHTML = convertHTML;
  H2F.audit = audit;
  H2F.serialize = serialize;
  H2F.deserialize = deserialize;
  H2F.b64encode = b64encode;
  H2F.b64decode = b64decode;
})(typeof globalThis !== 'undefined' ? globalThis : this);
