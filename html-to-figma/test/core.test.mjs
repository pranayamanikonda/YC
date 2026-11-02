// Pure-engine tests (Node, no browser): grid rules, layout inference, components, tokens, audit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../core/grid.js';
import '../core/layout.js';
import '../core/components.js';
import '../core/tokens.js';
import '../core/pipeline.js';

const H2F = globalThis.H2F;
const G = H2F.grid;
const E = H2F._layoutInternals.emptyStyle;

test('8pt grid: half-step 4 below 16, multiples of 8 above', () => {
  const r = { base: 8, halfStep: true };
  assert.deepEqual([0, 2, 3, 5, 6, 10, 13, 14, 18, 22, 26, 30, 38, 70].map((v) => G.snapSpace(v, r)), [0, 4, 4, 4, 8, 12, 12, 16, 16, 24, 24, 32, 40, 72]);
});

test('4pt grid: nearest multiple of 4', () => {
  const r = { base: 4 };
  assert.deepEqual([1, 2, 5, 7, 10, 13, 18, 22, 27].map((v) => G.snapSpace(v, r)), [0, 4, 4, 8, 12, 12, 20, 24, 28]);
});

test('radius: pills stay pills, others snap', () => {
  const r = { base: 8 };
  assert.equal(G.snapRadius(9999, 100, 40, r), G.PILL);
  assert.equal(G.snapRadius(20, 100, 40, r), G.PILL); // half the height → pill
  assert.equal(G.snapRadius(15, 300, 300, r), 16);
  assert.equal(G.snapRadius(9, 300, 300, r), 8);
  assert.equal(G.snapRadius(6, 300, 300, r), 8);
});

test('type scale and 4pt line heights', () => {
  assert.equal(G.snapFontSize(19), 18);
  assert.equal(G.snapFontSize(46), 44);
  assert.equal(G.snapFontSize(15), 15);
  assert.equal(G.snapLineHeight(27), 28);
  assert.equal(G.snapLineHeight(22), 24);
});

test('colour names', () => {
  assert.equal(G.colorName({ r: 1, g: 1, b: 1 }), 'white');
  assert.equal(G.colorName({ r: 0.31, g: 0.27, b: 0.9 }).split('/')[0], 'indigo');
  assert.equal(G.colorName({ r: 0.5, g: 0.5, b: 0.5 }).split('/')[0], 'gray');
});

// ---- synthetic raw trees -------------------------------------------------
let id = 0;
const frame = (box, s = {}, children = [], extra = {}) => ({ id: 'n' + ++id, kind: 'frame', tag: 'DIV', name: extra.name || 'Frame', box, s: Object.assign(E(), s), children, ...extra });
const text = (box, str, extra = {}) => ({
  id: 'n' + ++id, kind: 'text', tag: 'P', name: str, box, s: Object.assign(E(), extra.s || {}),
  text: { segments: [{ text: str, family: ['Inter'], weight: 400, italic: false, size: 16, lineHeight: 24, letterSpacing: 0, color: { r: 0, g: 0, b: 0, a: 1 }, decoration: 'NONE', transform: 'ORIGINAL' }], align: 'start', lines: 1 },
  children: [], ...extra,
});

test('block stack → vertical auto layout with measured padding and FILL children', () => {
  const root = frame({ x: 0, y: 0, w: 400, h: 200 }, { pad: [22, 18, 22, 18], bg: { r: 1, g: 1, b: 1, a: 1 } }, [
    text({ x: 18, y: 22, w: 364, h: 24 }, 'Title'),
    text({ x: 18, y: 62, w: 364, h: 24 }, 'Body'),
    text({ x: 18, y: 102, w: 364, h: 24 }, 'More'),
  ]);
  root.isRoot = true;
  const { root: out } = H2F.layout({ root, width: 400, height: 200 }, { base: 8 }, { screen: { width: 400, height: 200 } });
  assert.equal(out.layout.mode, 'VERTICAL');
  assert.equal(out.layout.gap, 16); // 16px measured
  assert.deepEqual(out.layout.padding.slice(0, 2), [24, 16]); // 22 → 24, 18 → 16
  assert.ok(out.children.every((c) => c.sizingH === 'FILL'));
  assert.equal(out.children[0].text.autoResize, 'HEIGHT');
});

test('flex row with space-between and centred items', () => {
  const nav = frame({ x: 0, y: 0, w: 800, h: 64 }, { display: 'flex', flexDir: 'row', justify: 'space-between', alignItems: 'center', pad: [20, 40, 20, 40] }, [
    text({ x: 40, y: 20, w: 60, h: 24 }, 'Logo'),
    frame({ x: 680, y: 14, w: 80, h: 36 }, { bg: { r: 0, g: 0, b: 1, a: 1 }, radius: [9, 9, 9, 9] }, [text({ x: 696, y: 20, w: 48, h: 24 }, 'Go')], { semantic: 'button' }),
  ]);
  const L = H2F.layout({ root: nav, width: 800, height: 64 }, { base: 8 }, {});
  const out = L.root;
  assert.equal(out.layout.mode, 'HORIZONTAL');
  assert.equal(out.layout.primary, 'SPACE_BETWEEN');
  assert.equal(out.layout.counter, 'CENTER');
  assert.equal(out.children[1].radius[0], 8);
});

test('irregular margins are grouped so each stack has one gap', () => {
  const root = frame({ x: 0, y: 0, w: 400, h: 300 }, {}, [
    text({ x: 0, y: 0, w: 400, h: 40 }, 'Heading', { tagName: 'H2' }),
    text({ x: 0, y: 48, w: 400, h: 24 }, 'Sub'),
    text({ x: 0, y: 104, w: 400, h: 24 }, 'Para 1'),
    text({ x: 0, y: 160, w: 400, h: 24 }, 'Para 2'),
  ]);
  const { root: out, report } = H2F.layout({ root, width: 400, height: 300 }, { base: 8 }, {});
  assert.equal(report.grouped, 1);
  assert.equal(out.children.length, 3);
  assert.equal(out.children[0].name, 'Heading group');
  assert.equal(out.children[0].layout.gap, 8);
  assert.equal(out.layout.gap, 32);
});

test('wrapping tiles → horizontal wrap with row gap', () => {
  const tiles = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) tiles.push(frame({ x: c * 130, y: r * 110, w: 120, h: 100 }, { bg: { r: 0.9, g: 0.9, b: 0.9, a: 1 } }));
  const grid = frame({ x: 0, y: 0, w: 400, h: 210 }, { display: 'grid' }, tiles);
  const { root: out } = H2F.layout({ root: grid, width: 400, height: 210 }, { base: 8 }, {});
  assert.equal(out.layout.mode, 'HORIZONTAL');
  assert.equal(out.layout.wrap, true);
  assert.equal(out.layout.gap, 12); // 10 is equidistant → rounds up to 12
  assert.equal(out.layout.crossGap, 12);
});

test('overlapping children fall back to absolute layout', () => {
  const root = frame({ x: 0, y: 0, w: 200, h: 200 }, {}, [frame({ x: 0, y: 0, w: 150, h: 150 }, { bg: { r: 1, g: 0, b: 0, a: 1 } }), frame({ x: 50, y: 50, w: 150, h: 150 }, { bg: { r: 0, g: 0, b: 1, a: 1 } })]);
  const { root: out } = H2F.layout({ root, width: 200, height: 200 }, { base: 8 }, {});
  assert.equal(out.layout.mode, 'NONE');
  assert.equal(out.children[1].x, 52); // positions snap to 4
});

test('repeated cards become one component; buttons get variants; tokens are collected', () => {
  const card = (x, label, primary) =>
    frame({ x, y: 0, w: 200, h: 120 }, { display: 'flex', flexDir: 'column', pad: [16, 16, 16, 16], rowGap: 16, bg: { r: 1, g: 1, b: 1, a: 1 }, radius: [12, 12, 12, 12], bw: [1, 1, 1, 1], bc: [{ r: 0.9, g: 0.9, b: 0.9, a: 1 }, null, null, null] }, [
      text({ x: x + 16, y: 16, w: 168, h: 24 }, label),
      frame({ x: x + 16, y: 56, w: 168, h: 40 }, { display: 'flex', justify: 'center', bg: primary ? { r: 0.3, g: 0.27, b: 0.9, a: 1 } : { r: 0.93, g: 0.95, b: 1, a: 1 }, radius: [8, 8, 8, 8], pad: [8, 16, 8, 16] }, [text({ x: x + 70, y: 64, w: 60, h: 24 }, 'Buy')], { semantic: 'button' }),
    ], { name: 'Card' });
  const root = frame({ x: 0, y: 0, w: 700, h: 120 }, { display: 'flex', colGap: 24 }, [card(0, 'A', false), card(224, 'B', true), card(448, 'C', false)]);
  root.isRoot = true;
  const doc = H2F.buildDoc({ root, width: 700, height: 120, assets: {} }, { screen: { width: 700, height: 120 }, rules: { base: 8 } });
  const names = Object.values(doc.components).map((c) => c.name).sort();
  assert.ok(names.includes('Button/Primary') && names.includes('Button/Secondary'), names.join());
  assert.ok(doc.tokens.colors.length >= 3);
  assert.ok(doc.tokens.spacing.some((s) => s.value === 16));
  assert.equal(doc.report.audit.score, 100);
  const json = H2F.serialize(doc);
  assert.equal(H2F.deserialize(json).root.name, doc.root.name);
});
