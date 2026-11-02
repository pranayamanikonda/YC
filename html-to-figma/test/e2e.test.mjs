// End-to-end: real Chromium renders each sample through the website build, the resulting
// .h2f.json is fed to the plugin main thread running against a strict Figma API mock.
// Also drives the plugin UI (ui.html) and checks it posts a valid build message.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { start } from '../scripts/serve.mjs';
import { loadPlugin } from './figma-mock.mjs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  chromium = null;
}
const root = fileURLToPath(new URL('..', import.meta.url));
let server, browser, page;
const PORT = 5211;

before(async () => {
  if (!chromium) return;
  server = await start(PORT);
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`http://localhost:${PORT}/`);
});
after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

async function convert(sample, base = 8) {
  return page.evaluate(async ({ sample, base }) => {
    const s = H2F.SAMPLES[sample];
    const screen = H2F.SCREENS.find((x) => x.id === s.screen);
    const doc = await H2F.convertHTML(s.html, { screen, rules: { base }, name: s.label });
    return H2F.serialize(doc);
  }, { sample, base });
}

function gridOk(v, base) {
  return v === 0 || v >= 9999 || (v % 4 === 0 && (base === 4 || v < 16 || v % 8 === 0));
}

for (const sample of ['pricing', 'login', 'dashboard']) {
  test(`${sample}: HTML → design doc → Figma (mock)`, { skip: !chromium && 'playwright not installed' }, async () => {
    const json = await convert(sample);
    const doc = JSON.parse(json);
    assert.equal(doc.format, 'h2f');
    assert.ok(doc.report.autoLayoutFrames > 5, 'auto layout frames');
    assert.ok(Object.keys(doc.components).length >= 3, 'components detected');
    assert.equal(doc.report.audit.score, 100, 'all spacing on grid');

    const env = loadPlugin(`${root}/plugin/dist/code.js`);
    const H2Fdoc = JSON.parse(json); // plugin receives plain JSON (assets base64 → decode like the UI does)
    for (const a of Object.values(H2Fdoc.assets)) if (a.b64) a.bytes = Array.from(Buffer.from(a.b64, 'base64'));
    const reply = await env.send({ type: 'build', doc: H2Fdoc, options: { components: true, tokens: true } });
    assert.equal(reply.type, 'done', JSON.stringify(reply));
    const sum = reply.summary;
    assert.equal(sum.warnings.length, 0, 'build warnings: ' + sum.warnings.join('; '));
    assert.ok(sum.components >= 3 && sum.instances >= sum.components, `components ${sum.components} instances ${sum.instances}`);
    assert.ok(sum.variables > 5 && sum.textStyles > 3);

    const screen = env.page.children.find((n) => n.type === 'FRAME');
    assert.equal(screen.width, doc.meta.screen.width);
    assert.ok(screen.layoutMode !== 'NONE');
    // every auto layout frame in the canvas respects the grid
    const all = [screen, ...screen.findAll()];
    for (const n of all) {
      if (n.layoutMode && n.layoutMode !== 'NONE') {
        for (const k of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing']) assert.ok(gridOk(n[k], 8), `${n.name}.${k}=${n[k]}`);
      }
    }
    assert.ok(all.some((n) => n.type === 'INSTANCE'), 'instances placed in the screen');
    assert.ok(all.some((n) => n.boundVariables && n.boundVariables.paddingTop), 'spacing variables bound');
    const section = env.page.children.find((n) => n.type === 'SECTION');
    assert.ok(section && section.children.length > 0, 'components section');
  });
}

test('4pt grid option yields 4pt values', { skip: !chromium && 'playwright not installed' }, async () => {
  const doc = JSON.parse(await convert('pricing', 4));
  assert.equal(doc.meta.rules.base, 4);
  assert.equal(doc.report.audit.score, 100);
});

test('plugin UI converts a sample and posts a build message', { skip: !chromium && 'playwright not installed' }, async () => {
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  // the plugin UI is loaded in an iframe by Figma; emulate parent.postMessage capture
  await p.goto(`http://localhost:${PORT}/`); // same-origin page for fonts; then swap content
  await p.setContent(readFileSync(`${root}/plugin/dist/ui.html`, 'utf8'));
  await p.evaluate(() => { window.__posted = []; window.parent.postMessage = (m) => window.__posted.push(m); }); // Figma hosts the UI in an iframe; capture parent.postMessage
  await p.selectOption('#sample', 'login');
  await p.click('#go');
  await p.waitForFunction(() => window.__posted.some((m) => m.pluginMessage && m.pluginMessage.type === 'build'), null, { timeout: 20000 });
  const msg = await p.evaluate(() => window.__posted.find((m) => m.pluginMessage.type === 'build').pluginMessage);
  assert.equal(msg.doc.meta.screen.width, 393);
  assert.ok(msg.doc.root.children.length > 0);
  assert.deepEqual(errors, []);
  await p.close();
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const KITCHEN = `<!doctype html><html><head><style>
  body{margin:0;font-family:Inter,sans-serif}
  .wrap{max-width:960px;margin:0 auto;padding:40px 20px}
  .hero{background:linear-gradient(90deg,#6366f1,#ec4899);border-radius:20px;padding:30px;color:#fff;position:relative}
  .badge{position:absolute;top:12px;right:12px;background:#fff;color:#111;padding:2px 8px;border-radius:999px;font-size:12px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:30px}
  .card{background:#fff;border-radius:14px;box-shadow:0 4px 12px rgba(0,0,0,.1);overflow:hidden}
  .card img{width:100%;height:120px;object-fit:cover;display:block}
  .card p{margin:12px 14px 16px;font-size:14px}
  .glass{backdrop-filter:blur(10px);filter:blur(1px);background:rgba(255,255,255,.5);height:20px;margin-top:20px}
</style></head><body><div class="wrap">
  <div class="hero"><h1 style="margin:0">Hello <em>world</em>, <strong>bold</strong> <a href="#">link</a></h1><span class="badge">New</span></div>
  <div class="grid">
    <div class="card"><img src="${PNG}"><p>One</p></div><div class="card"><img src="${PNG}"><p>Two</p></div><div class="card"><img src="${PNG}"><p>Three</p></div>
    <div class="card"><img src="${PNG}"><p>Four</p></div><div class="card"><img src="${PNG}"><p>Five</p></div><div class="card"><img src="${PNG}"><p>Six</p></div>
  </div><div class="glass"></div>
</div></body></html>`;

test('kitchen sink: images, grid → wrap, absolute, gradient, effects, rich text, max-width', { skip: !chromium && 'playwright not installed' }, async () => {
  const json = await page.evaluate(async (html) => H2F.serialize(await H2F.convertHTML(html, { screen: { width: 1280, height: 800 }, rules: { base: 8 }, name: 'Kitchen' })), KITCHEN);
  const doc = JSON.parse(json);
  const all = [];
  (function w(n) { all.push(n); (n.children || []).forEach(w); })(doc.root);
  const wrap = all.find((n) => n.layout && n.layout.wrap);
  assert.ok(wrap, 'grid became a wrap layout');
  assert.equal(wrap.layout.gap, 16);
  assert.equal(wrap.layout.crossGap, 16);
  assert.ok(all.some((n) => n.maxWidth === 1000 && n.sizingH === 'FILL'), 'max-width container (960 + 2×20 padding, content-box) → FILL + maxWidth');
  assert.ok(all.some((n) => n.name === 'Paragraph container' && n.layout.padding[3] === 16), 'side margins become wrapper padding (14 → 16)');
  assert.ok(all.some((n) => n.absolute && n.name === 'Badge'), 'absolute badge');
  assert.ok(all.some((n) => (n.fills || []).some((f) => f.type === 'GRADIENT_LINEAR')), 'gradient');
  assert.ok(all.some((n) => (n.effects || []).some((e) => e.type === 'DROP_SHADOW')), 'shadow');
  assert.ok(all.some((n) => (n.effects || []).some((e) => e.type === 'BACKGROUND_BLUR')), 'backdrop blur');
  const h1 = all.find((n) => n.type === 'TEXT' && /Hello/.test(n.text.segments.map((s) => s.text).join('')));
  assert.equal(h1.text.segments.map((s) => s.text).join(''), 'Hello world, bold link');
  assert.ok(h1.text.segments.length >= 4, 'styled ranges');
  assert.equal(Object.keys(doc.assets).length, 1, 'identical images deduplicated');
  const card = Object.values(doc.components).find((c) => c.name === 'Card');
  assert.ok(card && card.count === 6, 'cards → component');

  const env = loadPlugin(`${root}/plugin/dist/code.js`);
  const d2 = JSON.parse(json);
  for (const a of Object.values(d2.assets)) if (a.b64) a.bytes = new Uint8Array(Buffer.from(a.b64, 'base64'));
  const reply = await env.send({ type: 'build', doc: d2, options: {} });
  assert.equal(reply.type, 'done', JSON.stringify(reply));
  assert.equal(reply.summary.warnings.length, 0, reply.summary.warnings.join('; '));
  assert.equal(env.images.length, 1);
  assert.equal(reply.summary.instances, 6);
});

test('image → AI request shape (intercepted) → HTML → design', { skip: !chromium && 'playwright not installed' }, async () => {
  let seen = null;
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const req = route.request();
    seen = { headers: req.headers(), body: JSON.parse(req.postData()) };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '```html\n<!doctype html><html><body style="margin:0"><div style="display:flex;gap:16px;padding:24px"><button>A</button><button>B</button></div></body></html>\n```' }] }),
    });
  });
  const res = await page.evaluate(async (png) => {
    const html = await H2F.ai.imageToHTML(png, { apiKey: 'sk-ant-test', width: 393, height: 852, base: 8 });
    const doc = await H2F.convertHTML(html, { screen: { width: 393, height: 852 }, rules: { base: 8 } });
    return { html, buttons: Object.values(doc.components).map((c) => c.name) };
  }, PNG);
  await page.unroute('https://api.anthropic.com/v1/messages');
  assert.equal(seen.headers['x-api-key'], 'sk-ant-test');
  assert.equal(seen.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(seen.headers['anthropic-version'], '2023-06-01');
  assert.equal(seen.body.model, 'claude-opus-5-5');
  assert.equal(seen.body.messages[0].content[0].type, 'image');
  assert.match(seen.body.messages[0].content[1].text, /multiple of 8px/);
  assert.match(seen.body.messages[0].content[1].text, /393px wide/);
  assert.match(res.html, /^<!doctype html>/);
  assert.ok(res.buttons.includes('Button'));
});

test('website: Copy SVG produces valid, renderable SVG with real text layers', { skip: !chromium && 'playwright not installed' }, async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(`http://localhost:${PORT}/`);
  await p.waitForFunction(() => /^Done/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
  const res = await p.evaluate(async () => {
    const svg = window.__h2fToSVG();
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const err = xml.querySelector('parsererror');
    const texts = [...xml.querySelectorAll('text')].map((t) => t.textContent);
    const groups = xml.querySelectorAll('g[id]').length;
    const ok = await new Promise((r) => { const i = new Image(); i.onload = () => r(i.naturalWidth); i.onerror = () => r(0); i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    return { err: err && err.textContent, texts, groups, width: ok, root: xml.documentElement.getAttribute('width') };
  });
  assert.equal(res.err, null);
  assert.ok(res.texts.includes('Plans that scale with you'), res.texts.slice(0, 5).join(' | '));
  assert.ok(res.texts.some((t) => /Unlimited projects/.test(t)));
  assert.ok(res.groups > 20, 'named groups: ' + res.groups);
  assert.equal(res.root, '1440');
  assert.equal(res.width, 1440, 'renders as an image');
  await p.close();
});

test('plugin UI: pasting a design copied from the website builds it immediately', { skip: !chromium && 'playwright not installed' }, async () => {
  const json = await convert('login');
  const p = await browser.newPage();
  await p.setContent(readFileSync(`${root}/plugin/dist/ui.html`, 'utf8'));
  await p.evaluate(() => { window.__posted = []; window.parent.postMessage = (m) => window.__posted.push(m); });
  await p.evaluate((text) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, json);
  await p.waitForFunction(() => window.__posted.some((m) => m.pluginMessage.type === 'build'), null, { timeout: 10000 });
  const msg = await p.evaluate(() => window.__posted.find((m) => m.pluginMessage.type === 'build').pluginMessage);
  assert.equal(msg.doc.meta.screen.width, 393);
  await p.close();
});
