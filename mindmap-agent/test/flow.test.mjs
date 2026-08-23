import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const SHOTS = '/tmp/claude-0/-home-user-YC/1155a4ba-8d3f-5635-9748-08207452529d/scratchpad/shots';
const FILE = 'file:///home/user/YC/mindmap-agent/probe.html';
const results = [];
const check = (name, ok, extra='') => { results.push(`${ok?'PASS':'FAIL'}  ${name}${extra?' — '+extra:''}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/fonts\.g(oogle|static)apis?\.com|ERR_CONNECTION_RESET|ERR_INTERNET_DISCONNECTED/.test(m.text() + m.location().url)) errors.push('console: ' + m.text()); });

await page.goto(FILE);
await page.waitForSelector('.brief');
check('brief screen renders', await page.locator('h1').innerText() !== '');
check('expectations panel present', await page.locator('.expectations .no li').count() >= 3);
await page.screenshot({ path: `${SHOTS}/01-brief.png`, fullPage: true });

// guardrail: thin brief
await page.fill('#topic', 'marketing');
await page.click('[data-act="start"]');
await page.waitForSelector('.notice--error');
check('thin-brief guardrail fires', (await page.locator('.notice--error h3').innerText()).includes('too thin'));
await page.screenshot({ path: `${SHOTS}/02-guardrail.png` });
await page.click('[data-act="dismiss"]');

// custom brief with no key -> honest mode-limit notice
await page.fill('#topic', 'Plan a customer research programme for a mid-market logistics SaaS next quarter.');
await page.click('[data-act="start"]');
await page.waitForSelector('.notice--error');
check('mode-limit notice for un-recorded brief', (await page.locator('.notice--error h3').innerText()).includes('recorded'));
await page.click('[data-act="dismiss"]');

// recorded example
await page.click('[data-act="example"][data-arg="kyc"]');
await page.click('[data-act="start"]');
await page.waitForSelector('.clarify');
const qCount = await page.locator('.q').count();
check('clarifying questions shown', qCount >= 3, `${qCount} questions`);
check('each question states its skip default', await page.locator('.q .hint').count() === qCount);
await page.screenshot({ path: `${SHOTS}/03-clarify.png`, fullPage: true });

// answer one, skip one, free-text one
await page.locator('.q').nth(0).locator('.sugg').nth(0).click();
check('suggestion selects', await page.locator('.q').nth(0).locator('.sugg[aria-pressed="true"]').count() === 1);
await page.locator('.q').nth(1).locator('input[type="text"]').fill('Only completers, legal says no re-contact');
await page.locator('.q').nth(2).locator('[data-act="skip"]').click();
check('skip shows the assumption', (await page.locator('.q--skipped .skipnote').innerText()).includes('assume'));
await page.screenshot({ path: `${SHOTS}/04-clarify-answered.png`, fullPage: true });

await page.click('[data-act="build"]');
await page.waitForSelector('.workspace');
const nodes = await page.locator('[data-node]').count();
check('map renders with nodes', nodes > 10, `${nodes} nodes`);
check('assumption chips shown', await page.locator('.chip--assumption').count() > 0);
check('confidence badges shown', await page.locator('.conf').count() > 0);
check('dock asks a probing question', await page.locator('.dock .ping').count() === 1);
await page.screenshot({ path: `${SHOTS}/05-map.png`, fullPage: true });

// inspector
await page.locator('[data-node] .node__body').nth(1).click();
await page.waitForSelector('.insp__title');
check('inspector shows rationale', await page.locator('.insp__why').count() === 1);
check('inspector shows alternatives', await page.locator('.alt').count() >= 2);
check('inspector shows probes', await page.locator('.probe-q').count() >= 1);
await page.screenshot({ path: `${SHOTS}/06-inspector.png`, fullPage: true });

// rename + undo
const firstLabel = await page.locator('[data-node] .node__label').nth(1).innerText();
await page.click('[data-act="edit"]');
await page.keyboard.press('Control+A');
await page.keyboard.type('Renamed by the user');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
check('inline rename applies', (await page.locator('[data-node] .node__label').nth(1).innerText()) === 'Renamed by the user');
await page.click('[data-act="undo"]');
await page.waitForTimeout(150);
check('undo restores the label', (await page.locator('[data-node] .node__label').nth(1).innerText()) === firstLabel);

// lock + vote + delete + undo
await page.locator('[data-node] .node__body').nth(1).click();
await page.click('[data-act="lock"]');
check('lock marks the node', await page.locator('.node--locked').count() === 1);
await page.click('[data-act="vote-down"]');
check('vote registers', await page.locator('.node--voted-down').count() === 1);
const before = await page.locator('[data-node]').count();
await page.click('[data-act="delete"]');
await page.waitForTimeout(120);
check('delete removes the subtree', (await page.locator('[data-node]').count()) < before);
await page.click('[data-act="undo"]');
await page.waitForTimeout(120);
check('undo restores the subtree', (await page.locator('[data-node]').count()) === before);

// deepen (recorded branch) — select n2
await page.locator('[data-node="n2"] .node__body').click();
await page.click('[data-act="deepen"]');
await page.waitForTimeout(200);
check('recorded deepen adds children', await page.locator('[data-node="n2d"]').count() === 1);
await page.screenshot({ path: `${SHOTS}/07-deepened.png`, fullPage: true });

// deepen an unrecorded branch -> graceful notice
await page.locator('[data-node="n3"] .node__body').click();
await page.click('[data-act="deepen"]');
await page.waitForSelector('.notice--error');
check('unrecorded deepen fails gracefully', (await page.locator('.notice--error h3').innerText()).includes('no recorded expansion'));
await page.click('[data-act="dismiss"]');

// refine via the dock
await page.fill('[data-dock-input]', 'No — we only log a single kyc_step_exit event with no reason attached.');
await page.click('[data-act="dock-answer"]');
await page.waitForTimeout(250);
check('refine produces a change note', await page.locator('.dock__head .chip--live').count() === 1);
check('diff highlights added nodes', await page.locator('.node--added').count() >= 1);
check('map updated from the answer', (await page.locator('[data-node="n1"] .node__label').innerText()).includes('Instrument'));
await page.screenshot({ path: `${SHOTS}/08-refined.png`, fullPage: true });
await page.click('[data-act="clear-diff"]');
check('clearing highlights works', await page.locator('.node--added').count() === 0);

// exports
await page.click('[data-act="export"]');
await page.waitForSelector('.modal pre');
const md = await page.locator('.modal pre').innerText();
check('markdown export has structure', md.includes('# ') && md.includes('_why:_'));
await page.click('[data-act="export-tab"][data-arg="mermaid"]');
const mm = await page.locator('.modal pre').innerText();
check('mermaid export starts with mindmap', mm.startsWith('mindmap') && mm.includes('root(('));
await page.click('[data-act="export-tab"][data-arg="json"]');
const js = await page.locator('.modal pre').innerText();
let jsonOk = true; try { JSON.parse(js); } catch (e) { jsonOk = false; }
check('json export parses', jsonOk);
await page.click('[data-act="export-tab"][data-arg="log"]');
const lg = await page.locator('.modal pre').innerText();
check('session log captures feedback', lg.includes('"feedback"') && lg.includes('question_skipped'));
await page.click('[data-act="export-tab"][data-arg="prompt"]');
check('prompt is shown verbatim', (await page.locator('.modal pre').innerText()).includes('SYSTEM'));
await page.screenshot({ path: `${SHOTS}/09-export.png`, fullPage: true });
await page.click('[data-act="close-modal"]');

// dark theme render
await page.emulateMedia({ colorScheme: 'dark' });
await page.screenshot({ path: `${SHOTS}/10-map-dark.png`, fullPage: true });
await page.emulateMedia({ colorScheme: 'light' });

// mobile layout
const m = await browser.newPage({ viewport: { width: 390, height: 780 } });
await m.goto(FILE);
await m.click('[data-act="example"][data-arg="ml12"]');
await m.click('[data-act="start"]');
await m.waitForSelector('.clarify');
await m.click('[data-act="skip-all"]');
await m.click('[data-act="build"]');
await m.waitForSelector('.workspace');
const hScroll = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
check('no horizontal page scroll on mobile', !hScroll);
await m.screenshot({ path: `${SHOTS}/11-mobile.png`, fullPage: true });

// third case end to end
const g = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await g.goto(FILE);
await g.click('[data-act="example"][data-arg="gtm"]');
await g.click('[data-act="start"]');
await g.waitForSelector('.clarify');
await g.click('[data-act="build"]');
await g.waitForSelector('.workspace');
await g.fill('[data-dock-input]', 'If we are under 200 orders a week by week 8, we stop and rethink.');
await g.click('[data-act="dock-answer"]');
await g.waitForTimeout(250);
check('gtm case refines', (await g.locator('[data-node="m1"] .node__label').innerText()).includes('200 orders'));
await g.screenshot({ path: `${SHOTS}/12-gtm.png`, fullPage: true });

check('no page errors', errors.length === 0, errors.slice(0,3).join(' / '));
console.log(results.join('\n'));
console.log('\n' + results.filter(r=>r.startsWith('PASS')).length + '/' + results.length + ' passed');
await browser.close();
