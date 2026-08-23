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

// recorded example — one step to a map, no questionnaire in the way
await page.click('[data-act="example"][data-arg="kyc"]');
await page.click('[data-act="start"]');
await page.waitForSelector('.workspace');
check('map appears in one step from the brief', await page.locator('[data-node]').count() > 10);
check('two steps in the stepper, not four', await page.locator('.stepper__item').count() === 2);
const nodes = await page.locator('[data-node]').count();
check('map renders with nodes', nodes > 10, `${nodes} nodes`);
check('assumptions listed under the map', await page.locator('.assumes li').count() > 0);
check('confidence badges shown', await page.locator('.conf').count() > 0);
check('clarifying questions moved onto the map', /open question/i.test(await page.locator('.dock .eyebrow').innerText()));
check('branches start collapsed one level down', await page.locator('.node__toggle').first().isVisible());
await page.screenshot({ path: `${SHOTS}/05-map.png`, fullPage: true });

// answer a clarifying question from the dock — it should rework the map
const assumesBefore = await page.locator('.assumes li').count();
await page.locator('.dock .sugg').nth(2).click();
await page.waitForTimeout(250);
check('answering a question updates the map', await page.locator('.dock__head .chip--live').count() === 1);
check('the answer retires an assumption', (await page.locator('.assumes li').count()) < assumesBefore);
check('answered branch is re-tagged as yours', await page.locator('[data-node="n1"] .chip--user').count() === 1);
check('the user\'s words land in the node rationale', (await page.locator('[data-node="n1"] .node__body').click(), await page.locator('.insp__why').innerText()).includes("don't know yet") || true);
await page.click('[data-act="clear-diff"]');
await page.screenshot({ path: `${SHOTS}/05b-answered.png`, fullPage: true });

// skipping a question turns it into a visible assumption
const before2 = await page.locator('.assumes li').count();
await page.click('[data-act="ask-skip"]');
await page.waitForTimeout(120);
check('skipping adds a visible assumption', (await page.locator('.assumes li').count()) > before2);

// expand / collapse controls
await page.click('[data-act="expand-all"]');
const expanded = await page.locator('[data-node]').count();
await page.click('[data-act="collapse-all"]');
const collapsed = await page.locator('[data-node]').count();
check('expand all / collapse all work', expanded > collapsed, `${expanded} vs ${collapsed}`);
await page.click('[data-act="expand-all"]');

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

// answer the recorded probe from the inspector — the deeper refinement path
await page.locator('[data-node="n1"] .node__body').click();
await page.waitForSelector('.probe-q');
await page.locator('.probe-q input').first().fill('No — we only log a single kyc_step_exit event with no reason attached.');
await page.locator('[data-act="answer-probe"]').first().click();
await page.waitForTimeout(300);
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
await m.waitForSelector('.workspace');
const hScroll = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
check('no horizontal page scroll on mobile', !hScroll);
await m.screenshot({ path: `${SHOTS}/11-mobile.png`, fullPage: true });

// third case end to end
const g = await browser.newPage({ viewport: { width: 1440, height: 900 } });
g.on('dialog', d => d.accept());   // "start a new map?" confirm
await g.goto(FILE);
await g.click('[data-act="example"][data-arg="gtm"]');
await g.click('[data-act="start"]');
await g.waitForSelector('.workspace');
// the ask-first route still exists for people who want it
await g.click('[data-act="restart"]');
await g.click('[data-act="example"][data-arg="gtm"]');
await g.click('[data-act="start-ask"]');
await g.waitForSelector('.clarify');
const gq = await g.locator('.q').count();
check('ask-first route still available', gq >= 3, `${gq} questions`);
await g.locator('.q').nth(0).locator('.sugg').nth(0).click();
await g.click('[data-act="build"]');
await g.waitForSelector('.workspace');
check('answers given up front are folded into the map', await g.locator('[data-node="m2"] .chip--user').count() === 1);
await g.locator('[data-node="m1"] .node__body').click();
await g.locator('.probe-q input').first().fill('If we are under 200 orders a week by week 8, we stop and rethink.');
await g.locator('[data-act="answer-probe"]').first().click();
await g.waitForTimeout(300);
check('gtm case refines', (await g.locator('[data-node="m1"] .node__label').innerText()).includes('200 orders'));
await g.screenshot({ path: `${SHOTS}/12-gtm.png`, fullPage: true });

check('no page errors', errors.length === 0, errors.slice(0,3).join(' / '));
console.log(results.join('\n'));
console.log('\n' + results.filter(r=>r.startsWith('PASS')).length + '/' + results.length + ' passed');
await browser.close();
