/* ─────────────────────────────────────────────────────────────
   Probe — application logic
   Two run modes, one code path:
     live      → calls the Anthropic API with the viewer's own key
     recorded  → replays saved outputs of the same prompts
   Everything after generation (editing, locking, undo, diffing,
   export) is local and identical in both modes.
   ───────────────────────────────────────────────────────────── */

const LS = {
  get(k, d) { try { const v = localStorage.getItem('probe.' + k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('probe.' + k, v); } catch (e) { /* private mode */ } },
  del(k) { try { localStorage.removeItem('probe.' + k); } catch (e) {} }
};

/* Artifact viewers block outbound requests, so live mode cannot run there.
   Detect it rather than letting the viewer hit a confusing network error. */
const LIVE_BLOCKED = (function () {
  try {
    if (typeof window !== 'undefined' && window.claude) return true;
    return /(^|\.)claude\.ai$|claudeusercontent\.com$|artifacts?\..*anthropic/.test(location.hostname);
  } catch (e) { return false; }
})();

const MODELS = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — balanced (default)' },
  { id: 'claude-opus-5', label: 'Opus 5 — deepest, slowest' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fastest, shallowest' }
];

const S = {
  screen: 'brief',            // brief | clarify | map
  brief: { topic: '', purpose: 'plan', audience: '', depth: 3 },
  caseId: null,               // set when a recorded case is running
  questions: [],
  answers: {},                // qid -> {answer, skipped}
  map: null,
  title: '', summary: '', assumptions: [], changeNote: '',
  resolvedAssumptions: [],   // assumptions an answer has retired
  extraAssumptions: [],      // defaults created by explicitly skipping a question
  selectedId: null,
  editingId: null,
  history: [], future: [],
  busy: null,                 // {what:'...'} while a call is in flight
  error: null,                // {title, body, actions:[{label, act}]}
  modal: null,                // {kind, tab}
  toast: null,
  refineRound: 0,
  log: [],                    // feedback + interaction signals for week 2
  apiKey: LS.get('key', ''),
  model: LS.get('model', MODELS[0].id)
};

const app = document.getElementById('app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const now = () => new Date().toISOString();
const isLive = () => !LIVE_BLOCKED && !!S.apiKey;

function logEvent(type, detail) {
  S.log.push({ at: now(), type: type, detail: detail || null, round: S.refineRound });
}
function toast(msg) {
  S.toast = msg; render();
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { S.toast = null; render(); }, 2200);
}

/* ── tree helpers ─────────────────────────────────────────── */
function walk(node, fn, depth, parent) {
  depth = depth || 0;
  fn(node, depth, parent || null);
  (node.children || []).forEach(c => walk(c, fn, depth + 1, node));
}
function findNode(id, node) {
  node = node || S.map;
  if (!node) return null;
  let hit = null;
  walk(node, n => { if (n.id === id) hit = n; });
  return hit;
}
function findParent(id) {
  let hit = null;
  walk(S.map, (n, d, p) => { if (n.id === id) hit = p; });
  return hit;
}
function snapshot() {
  if (!S.map) return;
  S.history.push(stateShot());
  if (S.history.length > 40) S.history.shift();
  S.future = [];
}
function stateShot() {
  return {
    map: clone(S.map), assumptions: clone(S.assumptions),
    resolved: clone(S.resolvedAssumptions), extra: clone(S.extraAssumptions),
    changeNote: S.changeNote
  };
}
function restoreShot(shot) {
  S.map = shot.map; S.assumptions = shot.assumptions;
  S.resolvedAssumptions = shot.resolved || []; S.extraAssumptions = shot.extra || [];
  S.changeNote = shot.changeNote;
}

function newId(prefix) {
  let i = 1, id;
  do { id = (prefix || 'x') + i++; } while (findNode(id));
  return id;
}
function normalise(node, seen) {
  seen = seen || new Set();
  if (!node.id || seen.has(node.id)) node.id = 'g' + Math.random().toString(36).slice(2, 7);
  seen.add(node.id);
  node.label = String(node.label || 'Untitled').slice(0, 200);
  node.why = String(node.why || '');
  if (['high', 'medium', 'low'].indexOf(node.confidence) < 0) node.confidence = 'medium';
  if (['user', 'model', 'assumption'].indexOf(node.source) < 0) node.source = 'model';
  node.alternatives = Array.isArray(node.alternatives) ? node.alternatives.filter(a => a && a.label) : [];
  node.probes = Array.isArray(node.probes) ? node.probes.filter(p => typeof p === 'string') : [];
  node.children = Array.isArray(node.children) ? node.children : [];
  node.children.forEach(c => normalise(c, seen));
  return node;
}

/* ── diffing: what changed between two versions of the map ─── */
function markDiff(before, after) {
  const old = {};
  if (before) walk(before, n => { old[n.id] = n.label; });
  walk(after, n => {
    if (!(n.id in old)) n.status = 'added';
    else if (old[n.id] !== n.label) n.status = 'changed';
    else n.status = null;
  });
  return after;
}
function clearDiff() { if (S.map) walk(S.map, n => { n.status = null; }); }

/* ── model access (live mode) ─────────────────────────────── */
function extractJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('No JSON object found in the reply.');
  return JSON.parse(t.slice(a, b + 1));
}

async function anthropic(userPrompt, opts) {
  opts = opts || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || 90000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': S.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: S.model,
        max_tokens: opts.maxTokens || 4000,
        system: PROMPTS.SYSTEM,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error('api_' + res.status);
      err.status = res.status;
      err.detail = detail.slice(0, 300);
      throw err;
    }
    const data = await res.json();
    return (data.content || []).map(b => b.text || '').join('');
  } finally { clearTimeout(timer); }
}

/* one wrapper for every call: retry, JSON repair, then a clean failure */
async function askModel(userPrompt, validate, opts) {
  const attempts = [];
  let raw = '';
  for (let i = 0; i < 3; i++) {
    try {
      const prompt = i === 0 ? userPrompt
        : userPrompt + '\n\nYour previous reply could not be used: ' + attempts[attempts.length - 1] +
          '\nReturn only the JSON object described above, nothing else.';
      raw = await anthropic(prompt, opts);
      const parsed = extractJson(raw);
      const problem = validate(parsed);
      if (problem) throw new Error(problem);
      logEvent('model_call', { ok: true, attempt: i + 1, model: S.model });
      return parsed;
    } catch (e) {
      attempts.push(e.message);
      logEvent('model_call', { ok: false, attempt: i + 1, error: e.message });
      if (e.name === 'AbortError') throw tagged(e, 'timeout');
      if (e.status === 401) throw tagged(e, 'auth');
      if (e.status === 429) { await wait(1200 * (i + 1)); continue; }
      if (e.status >= 500) { await wait(900 * (i + 1)); continue; }
      if (e.message === 'Failed to fetch' || e.name === 'TypeError') throw tagged(e, 'network');
      await wait(400);
    }
  }
  throw tagged(new Error(attempts.join(' | ')), 'unusable');
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function tagged(e, kind) { e.kind = kind; return e; }

/* ── validators: never render a shape we did not check ────── */
function validateClarify(o) {
  if (!o || !Array.isArray(o.questions) || !o.questions.length) return 'no questions array';
  o.questions = o.questions.filter(q => q && q.question).slice(0, 6);
  if (!o.questions.length) return 'questions were empty';
  o.questions.forEach((q, i) => {
    q.id = q.id || ('q' + (i + 1));
    q.suggestions = Array.isArray(q.suggestions) ? q.suggestions.slice(0, 4) : [];
    q.assumeIfSkipped = q.assumeIfSkipped || 'no default stated — treat this as unknown';
    q.why = q.why || '';
  });
  return null;
}
function validateMap(o) {
  if (!o || !o.root || !o.root.label) return 'no root node';
  if (!Array.isArray(o.root.children) || o.root.children.length < 2) return 'root has fewer than two branches';
  o.assumptions = Array.isArray(o.assumptions) ? o.assumptions : [];
  o.title = o.title || S.brief.topic.slice(0, 60);
  o.summary = o.summary || '';
  normalise(o.root);
  return null;
}
function validateChildren(o) {
  if (!o || !Array.isArray(o.children) || !o.children.length) return 'no children returned';
  o.children.forEach(c => normalise(c));
  return null;
}

/* ── recorded mode ────────────────────────────────────────── */
function recordedCase(id) { return RECORDED.filter(c => c.id === id)[0] || null; }

function applyOps(map, ops) {
  ops.forEach(op => {
    if (op.set) {
      const n = findNode(op.set.id, map);
      if (n) Object.keys(op.set).forEach(k => { if (k !== 'id') n[k] = op.set[k]; });
    } else if (op.add) {
      const p = findNode(op.add.parentId, map);
      if (p) p.children.push(clone(op.add.node));
    } else if (op.remove) {
      const p = findParent(op.remove);
      if (p) p.children = p.children.filter(c => c.id !== op.remove);
    } else if (op.addProbe) {
      const n = findNode(op.addProbe.id, map);
      if (n) n.probes = (n.probes || []).concat([op.addProbe.probe]);
    }
  });
  return map;
}

/* the map arrives open one level deep; deeper branches expand on click */
function collapseBelow(depth) {
  walk(S.map, (n, d) => { n.collapsed = d >= depth && (n.children || []).length > 0; });
}
function setAllCollapsed(state) {
  walk(S.map, (n, d) => { if (d > 0 && (n.children || []).length) n.collapsed = state; });
}
function installMap(out) {
  S.map = out.root;
  S.title = out.title;
  S.summary = out.summary;
  S.assumptions = (out.assumptions || []).slice();
  S.resolvedAssumptions = [];
  S.extraAssumptions = [];
  S.changeNote = '';
  S.refineRound = 0;
  collapseBelow(2);
  S.screen = 'map';
  S.selectedId = S.map.children[0] ? S.map.children[0].id : null;
}
/* what the map is currently resting on: base assumptions minus the ones an
   answer retired, plus the defaults created by skipping a question outright */
function assumptionsShown() {
  return dedupe(S.assumptions.filter(a => S.resolvedAssumptions.indexOf(a) < 0).concat(S.extraAssumptions));
}

/* ── flow: brief → map (questions come with it, not before it) ─────── */
async function startFlow(askFirst) {
  const topic = S.brief.topic.trim();
  if (topic.split(/\s+/).length < 4 || topic.length < 20) {
    S.error = { title: 'That brief is too thin to map well', body: PROMPTS.BRIEF_TOO_THIN,
      actions: [{ label: 'Edit the brief', act: 'dismiss' }] };
    logEvent('guardrail', { reason: 'brief_too_thin' });
    return render();
  }

  if (!isLive()) {
    if (!S.caseId) {
      S.error = {
        title: 'This build can only run the three recorded briefs',
        body: LIVE_BLOCKED
          ? 'Live calls are blocked inside a shared artifact preview, so your own brief cannot be generated here. Pick a recorded example below to see the full flow, or run the file locally with your own Anthropic key.'
          : 'Add your Anthropic API key in Settings to map your own brief, or pick one of the recorded examples.',
        actions: [{ label: 'Pick a recorded example', act: 'dismiss' }].concat(LIVE_BLOCKED ? [] : [{ label: 'Open settings', act: 'settings' }])
      };
      logEvent('mode_limit', { blocked: LIVE_BLOCKED });
      return render();
    }
    const c = recordedCase(S.caseId);
    S.questions = clone(c.questions);
    S.answers = {};
    if (askFirst) {
      S.screen = 'clarify';
      logEvent('clarify_shown', { mode: 'recorded', n: S.questions.length });
      return render();
    }
    const m = clone(c.map);
    normalise(m.root);
    installMap(m);
    logEvent('map_built', { mode: 'recorded', firstStep: 'map', nodes: countNodes(), openQuestions: S.questions.length });
    return render();
  }

  if (askFirst) {
    return guarded('Working out what your brief does not tell me', async () => {
      const out = await askModel(PROMPTS.clarify(S.brief), validateClarify, { maxTokens: 1500 });
      S.questions = out.questions;
      S.answers = {};
      S.screen = 'clarify';
      logEvent('clarify_shown', { mode: 'live', n: S.questions.length });
    });
  }

  /* the default: map and questions are produced in parallel, so the map is
     on screen in one step and the questions arrive with it */
  await guarded('Mapping your brief — and working out what it does not tell me', async () => {
    const [clar, mapOut] = await Promise.all([
      askModel(PROMPTS.clarify(S.brief), validateClarify, { maxTokens: 1500 }),
      askModel(PROMPTS.buildMap(S.brief, []), validateMap, { maxTokens: 6000 })
    ]);
    S.questions = clar.questions;
    S.answers = {};
    installMap(mapOut);
    logEvent('map_built', { mode: 'live', firstStep: 'map', nodes: countNodes(), openQuestions: S.questions.length });
  });
}

/* ── flow: clarify → map (only when the user asked to be asked first) ─ */
async function buildMap() {
  const answers = S.questions.map(q => {
    const a = S.answers[q.id];
    return {
      question: q.question,
      answered: !!(a && a.answer && a.answer.trim()),
      answer: a ? a.answer : '',
      assumeIfSkipped: q.assumeIfSkipped
    };
  });
  const skipped = answers.filter(a => !a.answered).length;
  logEvent('answers_submitted', { answered: answers.length - skipped, skipped: skipped });

  if (!isLive()) {
    const c = recordedCase(S.caseId);
    const m = clone(c.map);
    normalise(m.root);
    installMap(m);
    S.extraAssumptions = S.questions.filter(q => !(S.answers[q.id] || {}).answer).map(q => q.assumeIfSkipped);
    applyAnsweredQuestionsLocally();
    logEvent('map_built', { mode: 'recorded', firstStep: 'clarify', nodes: countNodes() });
    return render();
  }
  await guarded('Building the map, then challenging it', async () => {
    const out = await askModel(PROMPTS.buildMap(S.brief, answers), validateMap, { maxTokens: 6000 });
    installMap(out);
    S.extraAssumptions = S.questions.filter(q => !(S.answers[q.id] || {}).answer).map(q => q.assumeIfSkipped);
    logEvent('map_built', { mode: 'live', firstStep: 'clarify', nodes: countNodes() });
  });
}

/* ask-first + recorded: fold the answers already given into the recorded map */
function applyAnsweredQuestionsLocally() {
  S.questions.forEach(q => {
    const a = (S.answers[q.id] || {}).answer;
    if (!a || !q.effect) return;
    applyOps(S.map, fillOps(q.effect.ops, a));
    if (typeof q.effect.resolves === 'number') {
      const t = S.assumptions[q.effect.resolves];
      if (t) S.resolvedAssumptions.push(t);
    }
  });
}

/* the user's own words go into the nodes an answer touches */
function fill(text, answer) {
  return String(text).replace(/\{\{answer\}\}/g, String(answer).replace(/\s+/g, ' ').trim());
}
function fillOps(ops, answer) {
  return clone(ops || []).map(op => {
    if (op.set && op.set.why) op.set.why = fill(op.set.why, answer);
    if (op.addProbe) op.addProbe.probe = fill(op.addProbe.probe, answer);
    if (op.add && op.add.node && op.add.node.why) op.add.node.why = fill(op.add.node.why, answer);
    return op;
  });
}

/* two phrasings of the same assumption should not both show */
function dedupe(list) {
  const seen = {}, out = [];
  list.filter(Boolean).forEach(a => {
    const key = String(a).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).slice(0, 6).join(' ');
    if (!seen[key]) { seen[key] = true; out.push(a); }
  });
  return out;
}

function countNodes() { let c = 0; if (S.map) walk(S.map, () => c++); return c; }

/* ── refinement: one path, whether the answer came from a question or a probe ── */
async function applyAnswer(question, answer, opts) {
  opts = opts || {};
  if (!answer || !answer.trim()) return;
  answer = answer.trim();
  logEvent('answer_given', { kind: opts.kind || 'probe', node: opts.nodeId || null, question: question, answer: answer });
  const before = clone(S.map);

  if (!isLive()) {
    const rec = opts.recorded;
    if (!rec) {
      S.error = {
        title: 'No recorded rework for that one',
        body: 'Recorded mode replays saved runs, so it can only rework the questions and probes it has a recording for — every clarifying question, and the probes marked ●. Your answer is still in the session log.',
        actions: [{ label: 'Show me one that is recorded', act: 'jump-recorded' }, { label: 'Close', act: 'dismiss' }]
      };
      return render();
    }
    snapshot();
    applyOps(S.map, fillOps(rec.ops, answer));
    if (typeof rec.resolves === 'number') {
      const t = S.assumptions[rec.resolves];
      if (t && S.resolvedAssumptions.indexOf(t) < 0) S.resolvedAssumptions.push(t);
    }
    markDiff(before, S.map);
    S.changeNote = fill(rec.note, answer);
    S.refineRound++;
    logEvent('map_refined', { mode: 'recorded', round: S.refineRound });
    return render();
  }

  const locked = [];
  walk(S.map, n => { if (n.locked) locked.push(n.label); });
  await guarded('Reworking the map around your answer', async () => {
    const out = await askModel(
      PROMPTS.refine(S.brief, JSON.stringify(stripForPrompt(S.map)), { question: question, answer: answer }, locked),
      validateMap, { maxTokens: 6000 });
    snapshot();
    const keepCollapse = {};
    walk(S.map, n => { keepCollapse[n.id] = n.collapsed; });
    S.map = out.root;
    S.title = out.title || S.title;
    S.summary = out.summary || S.summary;
    if (Array.isArray(out.assumptions)) { S.assumptions = out.assumptions; S.resolvedAssumptions = []; }
    S.changeNote = out.changeNote || 'The map was rebuilt around your answer.';
    markDiff(before, S.map);
    relockFrom(before);
    walk(S.map, (n, d) => { n.collapsed = (n.id in keepCollapse) ? keepCollapse[n.id] : d >= 2 && (n.children || []).length > 0; });
    S.refineRound++;
    logEvent('map_refined', { mode: 'live', round: S.refineRound });
  });
}

/* a clarifying question answered on the map */
function answerQuestion(qid, answer) {
  const q = S.questions.filter(x => x.id === qid)[0];
  if (!q) return;
  S.answers[qid] = { answer: answer, skipped: false };
  return applyAnswer(q.question, answer, { kind: 'question', recorded: q.effect });
}
/* …or waved away, which is what creates a visible assumption */
function skipQuestion(qid) {
  const q = S.questions.filter(x => x.id === qid)[0];
  if (!q) return;
  S.answers[qid] = { answer: '', skipped: true };
  if (S.extraAssumptions.indexOf(q.assumeIfSkipped) < 0) S.extraAssumptions.push(q.assumeIfSkipped);
  logEvent('question_skipped', { q: qid });
  render();
}

function sameish(a, b) { return String(a).slice(0, 40).toLowerCase() === String(b).slice(0, 40).toLowerCase(); }
function stripForPrompt(node) {
  const c = clone(node);
  walk(c, n => { delete n.status; delete n.collapsed; delete n.vote; delete n.userTouched; });
  return c;
}
function relockFrom(before) {
  const locked = {};
  walk(before, n => { if (n.locked) locked[n.id] = true; });
  walk(S.map, n => { if (locked[n.id]) n.locked = true; });
}

async function deepen(nodeId) {
  const node = findNode(nodeId);
  if (!node) return;
  if (!isLive()) {
    const c = recordedCase(S.caseId);
    if (!c.deepen || c.deepen.nodeId !== nodeId) {
      S.error = {
        title: 'That branch has no recorded expansion',
        body: 'Recorded mode ships one expansion per example — the branch marked "expandable" in the inspector. Everything else here (editing, locking, undo, export) works on any node.',
        actions: [{ label: 'Close', act: 'dismiss' }]
      };
      return render();
    }
    snapshot();
    const before = clone(S.map);
    node.children = (node.children || []).concat(clone(c.deepen.children));
    node.collapsed = false;
    markDiff(before, S.map);
    logEvent('branch_deepened', { mode: 'recorded', node: nodeId });
    return render();
  }
  const path = [];
  walk(S.map, (n, d, p) => { if (n.id === nodeId) { let cur = n; while (cur) { path.unshift(cur.label); cur = findParent(cur.id); } } });
  await guarded('Expanding "' + node.label + '"', async () => {
    const out = await askModel(PROMPTS.deepen(S.brief, node.label, path), validateChildren, { maxTokens: 1800 });
    snapshot();
    const before = clone(S.map);
    node.children = (node.children || []).concat(out.children);
    node.collapsed = false;
    markDiff(before, S.map);
    logEvent('branch_deepened', { mode: 'live', node: nodeId });
  });
}

/* ── failure handling: every call funnels through here ────── */
async function guarded(what, fn) {
  S.busy = { what: what }; S.error = null; render();
  try {
    await fn();
    S.busy = null; render();
  } catch (e) {
    S.busy = null;
    S.error = failureCard(e);
    logEvent('failure', { kind: e.kind || 'unknown', message: String(e.message).slice(0, 200) });
    render();
  }
}
function failureCard(e) {
  const retry = { label: 'Try again', act: 'retry' };
  const recorded = { label: 'Use a recorded example instead', act: 'to-brief' };
  switch (e.kind) {
    case 'auth': return { title: 'That API key was rejected',
      body: 'Anthropic returned 401. Check the key is a valid API key (it starts with sk-ant-) and has credit, then try again.',
      actions: [{ label: 'Open settings', act: 'settings' }, recorded] };
    case 'timeout': return { title: 'The model took too long',
      body: 'No reply within 90 seconds. A smaller model usually fixes this — or try again, since long waits are often transient.',
      actions: [retry, { label: 'Switch model', act: 'settings' }, recorded] };
    case 'network': return { title: 'Could not reach the API',
      body: 'The request never left the browser. If you opened this file directly, serve it instead (python3 -m http.server), since file:// pages are blocked from calling the API.',
      actions: [retry, recorded] };
    case 'unusable': return { title: 'The model replied, but not with a usable map',
      body: 'Three attempts came back malformed. This is usually a too-small model or a brief that is pulling in several directions at once. Your brief and answers are still here.',
      actions: [retry, { label: 'Switch model', act: 'settings' }, recorded] };
    default: return { title: 'Something went wrong on that step',
      body: String(e.message || e).slice(0, 240) + ' — nothing was lost; your brief, answers and map are all still here.',
      actions: [retry, recorded] };
  }
}
let lastAction = null;
function remember(fn) { lastAction = fn; return fn; }

/* ── exports ──────────────────────────────────────────────── */
function toMarkdown() {
  const lines = ['# ' + (S.title || S.brief.topic), '', S.summary, ''];
  const assumps = assumptionsShown();
  if (assumps.length) {
    lines.push('**Assumptions this map rests on**', '');
    assumps.forEach(a => lines.push('- ' + a));
    lines.push('');
  }
  walk(S.map, (n, d) => {
    if (d === 0) return;
    const bits = [];
    if (n.source === 'assumption') bits.push('assumption');
    if (n.source === 'user') bits.push('from your answers');
    if (n.confidence !== 'medium') bits.push(n.confidence + ' confidence');
    lines.push('  '.repeat(d - 1) + '- **' + n.label + '**' + (bits.length ? ' _(' + bits.join(', ') + ')_' : ''));
    if (n.why) lines.push('  '.repeat(d) + '- _why:_ ' + n.why);
    (n.alternatives || []).forEach(a => lines.push('  '.repeat(d) + '- _alternative:_ ' + a.label + ' — ' + a.tradeoff));
    (n.probes || []).forEach(p => lines.push('  '.repeat(d) + '- _open question:_ ' + p));
  });
  lines.push('', '---', 'Generated by Probe ' + PROMPTS.VERSION + ' (' + (isLive() ? 'live, ' + S.model : 'recorded run') + '). Model knowledge, not live research — verify before acting.');
  return lines.join('\n');
}
function toMermaid() {
  const lines = ['mindmap'];
  const safe = s => String(s).replace(/[()[\]{}"]/g, '').slice(0, 70);
  walk(S.map, (n, d) => {
    const text = d === 0 ? 'root((' + safe(n.label) + '))' : safe(n.label);
    lines.push('  '.repeat(d + 1) + text);
  });
  return lines.join('\n');
}
function toJson() {
  return JSON.stringify({
    generator: 'Probe ' + PROMPTS.VERSION, mode: isLive() ? 'live' : 'recorded',
    model: isLive() ? S.model : 'recorded-' + S.caseId, generatedAt: now(),
    brief: S.brief, title: S.title, summary: S.summary, assumptions: assumptionsShown(),
    answers: S.questions.map(q => ({ question: q.question, answer: (S.answers[q.id] || {}).answer || null, assumedInstead: (S.answers[q.id] || {}).answer ? null : q.assumeIfSkipped })),
    map: stripForPrompt(S.map)
  }, null, 2);
}
function toSessionLog() {
  return JSON.stringify({ promptVersion: PROMPTS.VERSION, mode: isLive() ? 'live' : 'recorded', brief: S.brief, events: S.log }, null, 2);
}
function currentPrompt() {
  const answers = S.questions.map(q => ({ question: q.question, answered: !!(S.answers[q.id] || {}).answer, answer: (S.answers[q.id] || {}).answer || '', assumeIfSkipped: q.assumeIfSkipped }));
  return 'SYSTEM\n──────\n' + PROMPTS.SYSTEM + '\n\nUSER (map step)\n──────\n' + PROMPTS.buildMap(S.brief, answers);
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied to clipboard'); }
    catch (e2) { toast('Copy failed — select the text and copy manually'); }
    ta.remove();
  }
}
