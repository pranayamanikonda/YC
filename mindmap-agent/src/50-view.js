/* ─────────────────────────────────────────────────────────────
   Probe — rendering and interaction
   ───────────────────────────────────────────────────────────── */

const STEPS = [
  { key: 'brief', n: '1', label: 'Brief' },
  { key: 'clarify', n: '2', label: 'Clarify' },
  { key: 'map', n: '3', label: 'Map' },
  { key: 'refine', n: '4', label: 'Refine' }
];

function stepState(key) {
  const order = ['brief', 'clarify', 'map', 'refine'];
  const current = S.screen === 'map' && S.refineRound > 0 ? 'refine' : S.screen;
  const i = order.indexOf(key), j = order.indexOf(current);
  return i === j ? 'now' : (i < j ? 'done' : 'todo');
}

function markLogo() {
  return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="3" fill="var(--probe)"/>' +
    '<circle cx="12" cy="12" r="7" stroke="var(--probe)" stroke-width="1.2" opacity=".55"/>' +
    '<circle cx="12" cy="12" r="10.6" stroke="var(--probe)" stroke-width="1" opacity=".28"/>' +
    '<line x1="12" y1="12" x2="21" y2="6" stroke="var(--probe)" stroke-width="1.2"/>' +
    '<circle cx="21" cy="6" r="1.8" fill="var(--amber)"/></svg>';
}

function topbar() {
  const modeChip = LIVE_BLOCKED
    ? '<span class="chip chip--recorded" title="Shared previews cannot call an API, so this session replays saved runs">recorded run</span>'
    : (isLive()
      ? '<span class="chip chip--live" title="Calling the Anthropic API with your key">live · ' + esc(S.model.replace('claude-', '').replace('-20251001', '')) + '</span>'
      : '<span class="chip chip--recorded" title="No API key set — replaying saved runs">recorded run</span>');

  const tools = [];
  if (S.screen === 'map') {
    tools.push(btn('undo', '↺ Undo', { disabled: !S.history.length, title: 'Undo the last change to the map' }));
    tools.push(btn('redo', '↻ Redo', { disabled: !S.future.length }));
    tools.push(btn('export', '↗ Export', { primary: false }));
  }
  tools.push(btn('settings', '⚙ Settings'));
  tools.push(btn('theme', 'Theme', { title: 'Switch light / dark / follow system', ghost: true, sm: true }));
  if (S.screen !== 'brief') tools.push(btn('restart', 'New map', { ghost: true }));

  return '<header class="topbar">' +
    '<div class="brandmark">' + markLogo() + '<div><b>Probe</b> <span>mind-map agent</span></div></div>' +
    '<nav class="stepper" aria-label="Progress">' +
    STEPS.map((s, i) => (i ? '<span class="stepper__sep">›</span>' : '') +
      '<span class="stepper__item stepper__item--' + stepState(s.key) + '"><b>' + s.n + '</b> ' + s.label + '</span>').join('') +
    '</nav>' +
    '<div class="topbar__spacer"></div>' +
    '<div class="topbar__tools">' + modeChip + tools.join('') + '</div>' +
    '</header>';
}

function btn(act, label, o) {
  o = o || {};
  return '<button class="btn' + (o.primary ? ' btn--primary' : '') + (o.ghost ? ' btn--ghost' : '') + (o.sm ? ' btn--sm' : '') +
    '" data-act="' + act + '"' + (o.id ? ' data-id="' + esc(o.id) + '"' : '') + (o.arg ? ' data-arg="' + esc(o.arg) + '"' : '') +
    (o.disabled ? ' disabled' : '') + (o.title ? ' title="' + esc(o.title) + '"' : '') + '>' + label + '</button>';
}

function trustline() {
  return '<div class="trustline">' +
    '<strong>What you are looking at:</strong> a map written by a language model from general knowledge — ' +
    'not live research, and not a source of facts, prices or citations. It is useful for structure, blind spots and questions to take to real sources.' +
    '</div>';
}

/* ── 1. brief ─────────────────────────────────────────────── */
function screenBrief() {
  const examples = RECORDED.map(c =>
    '<button class="example" data-act="example" data-arg="' + c.id + '"><b>' + esc(c.label) + '</b>' + esc(c.brief.topic.slice(0, 96)) + '…</button>'
  ).join('');

  return '<div class="stage stage--center"><div class="brief">' +
    '<div class="brief__head">' +
      '<div class="eyebrow">Step 1 · Brief</div>' +
      '<h1>Tell me what you are trying to work out.</h1>' +
      '<p>I will ask what your brief does not say, map it, then argue with the map — naming the alternatives you did not ask for and the assumptions it rests on.</p>' +
    '</div>' +

    '<div class="card brief__panel">' +
      '<div class="field">' +
        '<label for="topic">Your brief</label>' +
        '<textarea id="topic" rows="4" data-bind="topic" placeholder="e.g. Plan a UX research study for our onboarding flow — new users drop off before finishing KYC and we do not know why.">' + esc(S.brief.topic) + '</textarea>' +
        '<span class="hint">A sentence or two beats a keyword. Say what you are deciding, planning or trying to understand.</span>' +
      '</div>' +
      '<div class="row">' +
        '<div class="field"><label for="purpose">I am trying to</label>' +
          '<select id="purpose" data-bind="purpose">' +
          ['explore', 'plan', 'decide', 'learn'].map(p => '<option value="' + p + '"' + (S.brief.purpose === p ? ' selected' : '') + '>' + p + '</option>').join('') +
          '</select></div>' +
        '<div class="field"><label for="audience">Who this is for</label>' +
          '<input id="audience" type="text" data-bind="audience" placeholder="e.g. my product team" value="' + esc(S.brief.audience) + '"></div>' +
        '<div class="field"><label for="depth">Levels deep</label>' +
          '<select id="depth" data-bind="depth">' + [2, 3, 4].map(d => '<option value="' + d + '"' + (Number(S.brief.depth) === d ? ' selected' : '') + '>' + d + '</option>').join('') + '</select></div>' +
      '</div>' +
      '<div class="field"><span class="eyebrow">Or start from a recorded run</span><div class="examples">' + examples + '</div></div>' +
      '<div class="row" style="align-items:center;gap:10px">' + btn('start', 'Ask me questions first →', { primary: true }) +
        '<span class="hint">' + (isLive() ? 'Live mode: your key, your brief.' : (LIVE_BLOCKED
          ? 'This shared preview replays recorded runs — pick an example above.'
          : 'No key set: pick a recorded example, or add a key in Settings to map your own brief.')) + '</span>' +
      '</div>' +
    '</div>' +

    '<div class="card expectations">' +
      '<div class="yes"><h3>Rely on it for</h3><ul>' +
        '<li>Structuring a messy brief into something you can argue with</li>' +
        '<li>Alternatives you did not ask for, with their trade-offs</li>' +
        '<li>Naming the assumptions a plan is quietly resting on</li>' +
        '<li>Questions worth taking to real users, data or experts</li>' +
      '</ul></div>' +
      '<div class="no"><h3>Do not rely on it for</h3><ul>' +
        '<li>Facts, numbers, prices or citations — it has no web access</li>' +
        '<li>Anything domain-specific it could not know about your company</li>' +
        '<li>Legal, medical or financial judgement</li>' +
        '<li>Deciding for you: it argues, you choose</li>' +
      '</ul></div>' +
    '</div>' +
    '</div></div>';
}

/* ── 2. clarify ───────────────────────────────────────────── */
function screenClarify() {
  const qs = S.questions.map((q, i) => {
    const a = S.answers[q.id] || {};
    const skipped = a.skipped;
    return '<div class="card q' + (skipped ? ' q--skipped' : '') + '">' +
      '<div class="q__top"><span class="q__n">Q' + (i + 1) + '</span><div style="flex:1">' +
        '<div class="q__text">' + esc(q.question) + '</div>' +
        (q.why ? '<div class="q__why">Why I ask: ' + esc(q.why) + '</div>' : '') +
      '</div></div>' +
      (skipped
        ? '<div class="q__foot"><span class="skipnote">Skipped — I will assume: ' + esc(q.assumeIfSkipped) + '</span>' + btn('unskip', 'Answer it after all', { sm: true, ghost: true, arg: q.id }) + '</div>'
        : '<div class="q__suggestions">' +
            (q.suggestions || []).map((s, si) => '<button class="sugg" data-act="sugg" data-arg="' + q.id + '" data-i="' + si + '" aria-pressed="' + (a.answer === s) + '">' + esc(s) + '</button>').join('') +
          '</div>' +
          '<input type="text" data-bind-answer="' + q.id + '" placeholder="…or answer in your own words" value="' + esc(a.answer && (q.suggestions || []).indexOf(a.answer) < 0 ? a.answer : '') + '">' +
          '<div class="q__foot">' + btn('skip', 'Skip — use your default', { sm: true, ghost: true, arg: q.id }) +
            '<span class="hint">If you skip: ' + esc(q.assumeIfSkipped) + '</span></div>')
      + '</div>';
  }).join('');

  const answered = S.questions.filter(q => (S.answers[q.id] || {}).answer).length;

  return '<div class="stage stage--center"><div class="clarify">' +
    '<div class="clarify__head"><div class="eyebrow">Step 2 · Clarify</div>' +
      '<h2>Before I map this, ' + S.questions.length + ' things your brief does not say.</h2>' +
      '<p style="margin:0;color:var(--ink-soft);font-size:13.5px">Answer what you know. Skipping is fine — every skipped question becomes a visible assumption on the map, not a silent one.</p></div>' +
    qs +
    '<div class="row" style="align-items:center;gap:10px">' +
      btn('build', 'Build the map →', { primary: true }) +
      btn('skip-all', 'Skip the rest and use your defaults', { ghost: true }) +
      '<span class="hint">' + answered + ' of ' + S.questions.length + ' answered</span>' +
    '</div>' +
    '<div>' + btn('back-to-brief', '← Change the brief', { ghost: true, sm: true }) + '</div>' +
    '</div></div>';
}

/* ── 3. map ───────────────────────────────────────────────── */
function confBadge(n) {
  return '<span class="conf conf--' + n.confidence + '" title="Model-stated confidence: ' + n.confidence + '"><i></i>' + n.confidence + '</span>';
}
function sourceChip(n) {
  if (n.source === 'user') return '<span class="chip chip--user" title="Rests on something you told me">your input</span>';
  if (n.source === 'assumption') return '<span class="chip chip--assumption" title="Rests on an assumption — check it">assumption</span>';
  return '<span class="chip chip--model" title="From the model\'s general knowledge">model</span>';
}

function renderNode(n, depth) {
  const kids = n.children || [];
  const hasKids = kids.length > 0;
  const cls = ['node'];
  if (depth === 0) cls.push('node--root');
  if (depth === 1) cls.push('node--l1');
  if (n.id === S.selectedId) cls.push('node--selected');
  if (n.locked) cls.push('node--locked');
  if (n.status === 'added') cls.push('node--added');
  if (n.status === 'changed') cls.push('node--changed');
  if (n.vote === 1) cls.push('node--voted-up');
  if (n.vote === -1) cls.push('node--voted-down');

  const label = S.editingId === n.id
    ? '<span class="node__label" contenteditable="true" data-edit="' + esc(n.id) + '">' + esc(n.label) + '</span>'
    : '<span class="node__label">' + esc(n.label) + '</span>';

  const meta = depth === 0 ? '' : '<span class="node__meta">' +
    (n.probes && n.probes.length ? '<span class="node__probecount" title="' + esc(n.probes.length) + ' probing question(s) on this branch">?' + n.probes.length + '</span>' : '') +
    (n.locked ? '<span class="chip" title="Locked — kept as written when the map is regenerated">locked</span>' : '') +
    sourceChip(n) + confBadge(n) + '</span>';

  const head = '<div class="' + cls.join(' ') + '" data-node="' + esc(n.id) + '">' +
    '<button class="node__toggle' + (hasKids ? '' : ' node__toggle--hidden') + '" data-act="toggle" data-id="' + esc(n.id) + '" aria-label="Expand or collapse">' +
      (n.collapsed ? '+' : '−') + '</button>' +
    '<div class="node__body" data-act="select" data-id="' + esc(n.id) + '">' + label + meta + '</div>' +
    '</div>';

  const children = hasKids && !n.collapsed
    ? '<div class="branch">' + kids.map(c => renderNode(c, depth + 1)).join('') + '</div>'
    : '';
  return head + children;
}

function hasRecordedRefinement(nodeId, probeText) {
  if (isLive()) return true;
  const c = recordedCase(S.caseId);
  if (!c) return false;
  return (c.refinements || []).some(r => r.probeId === nodeId && sameish(r.question, probeText));
}
function hasRecordedDeepen(nodeId) {
  if (isLive()) return true;
  const c = recordedCase(S.caseId);
  return !!(c && c.deepen && c.deepen.nodeId === nodeId);
}

function inspector() {
  const n = S.selectedId ? findNode(S.selectedId) : null;
  if (!n) return '<aside class="inspector"><div class="eyebrow">Inspector</div><p class="inspector__empty">Select any node to see why it is there, what it assumes, and what else could have gone in its place.</p></aside>';

  const alts = (n.alternatives || []).map((a, i) =>
    '<div class="alt"><b>' + esc(a.label) + '</b><p>' + esc(a.tradeoff) + '</p>' +
    '<div class="alt__act">' + btn('swap-alt', 'Use this framing instead', { sm: true, id: n.id, arg: String(i) }) + '</div></div>').join('');

  const probes = (n.probes || []).map((p, i) => {
    const rec = hasRecordedRefinement(n.id, p);
    return '<div class="probe-q">' + (rec && !isLive() ? '<span title="A recorded answer exists for this probe">● </span>' : '') + esc(p) +
      '<div class="probe-q__ask"><input type="text" data-probe-input="' + esc(n.id) + '-' + i + '" placeholder="Your answer changes the map">' +
      btn('answer-probe', 'Answer', { sm: true, primary: true, id: n.id, arg: String(i) }) + '</div></div>';
  }).join('');

  return '<aside class="inspector">' +
    '<div><div class="eyebrow">Inspector</div><div class="insp__title">' + esc(n.label) + '</div>' +
      '<div style="display:flex;gap:6px;margin-top:7px;flex-wrap:wrap">' + sourceChip(n) + confBadge(n) + '</div></div>' +

    (n.why ? '<div class="insp__section"><h4 class="eyebrow">Why this is here</h4><div class="insp__why">' + esc(n.why) + '</div></div>' : '') +

    (alts ? '<div class="insp__section"><h4 class="eyebrow">Are these the only options?</h4>' + alts + '</div>' : '') +

    (probes ? '<div class="insp__section"><h4 class="eyebrow">What this branch still needs from you</h4>' + probes + '</div>' : '') +

    '<div class="insp__section"><h4 class="eyebrow">Change it</h4><div class="insp__controls">' +
      btn('edit', '✎ Rename', { sm: true, id: n.id }) +
      btn('add-child', '+ Add child', { sm: true, id: n.id }) +
      btn('deepen', '↓ Deepen' + (!isLive() && !hasRecordedDeepen(n.id) ? ' (live only)' : ''), { sm: true, id: n.id, title: 'Ask for 2–4 more specific children under this node' }) +
      btn('lock', n.locked ? '🔓 Unlock' : '🔒 Lock', { sm: true, id: n.id, title: 'Locked nodes keep their wording when the map is regenerated' }) +
      btn('delete', '✕ Delete', { sm: true, id: n.id }) +
    '</div></div>' +

    '<div class="insp__section"><h4 class="eyebrow">Was this branch useful?</h4><div class="votebar">' +
      btn('vote-up', '👍 Useful', { sm: true, id: n.id }) +
      btn('vote-down', '👎 Generic', { sm: true, id: n.id }) +
      '<span class="hint">' + (n.vote === 1 ? 'marked useful' : n.vote === -1 ? 'marked generic' : 'saved to the session log') + '</span>' +
    '</div></div>' +
    '</aside>';
}

function openProbes() {
  const out = [];
  if (!S.map) return out;
  walk(S.map, n => { (n.probes || []).forEach((p, i) => { if (!(n.answeredProbes || []).includes(i)) out.push({ nodeId: n.id, i: i, text: p }); }); });
  if (!isLive()) {
    const rec = out.filter(p => hasRecordedRefinement(p.nodeId, p.text));
    if (rec.length) return rec.concat(out.filter(p => rec.indexOf(p) < 0));
  }
  return out;
}

function dock() {
  if (S.changeNote) {
    return '<div class="dock">' +
      '<div class="dock__head"><span class="chip chip--live">map updated</span>' +
        '<span style="font-size:13.5px">' + esc(S.changeNote) + '</span></div>' +
      '<div class="dock__q">' +
        btn('undo', '↺ Undo this round', { sm: true }) +
        btn('clear-diff', 'Keep it — clear the highlights', { sm: true, primary: true }) +
        '<span class="hint">Green edge = added · amber edge = reworded</span>' +
      '</div></div>';
  }
  const probes = openProbes();
  if (!probes.length) return '';
  const p = probes[S.dockIndex % probes.length];
  return '<div class="dock">' +
    '<div class="dock__head"><span class="ping"></span><span class="eyebrow">Step 4 · The agent is asking</span></div>' +
    '<div class="dock__q"><span style="font-size:14.5px;font-weight:500;flex:1 1 100%">' + esc(p.text) + '</span></div>' +
    '<div class="dock__q">' +
      '<input type="text" data-dock-input placeholder="Answer in a line — the map will change" aria-label="Answer the agent">' +
      btn('dock-answer', 'Rework the map', { primary: true, id: p.nodeId, arg: String(p.i) }) +
      btn('dock-next', 'Ask me a different one', { ghost: true }) +
      btn('dock-jump', 'Show me the branch', { ghost: true, id: p.nodeId }) +
    '</div></div>';
}

function screenMap() {
  const assumptions = S.assumptions.length
    ? '<div class="assumes"><h4>What this map assumes</h4><ul>' +
      S.assumptions.map(a => '<li>' + esc(a) + '</li>').join('') +
      '</ul></div>'
    : '';

  return '<div class="mapscreen"><div class="workspace">' +
    '<div class="canvas">' +
      '<div class="maphead"><div style="flex:1 1 320px">' +
        '<div class="eyebrow">Step 3 · Map · ' + countNodes() + ' nodes' + (S.refineRound ? ' · round ' + (S.refineRound + 1) : '') + '</div>' +
        '<h2>' + esc(S.title || S.brief.topic) + '</h2>' +
        (S.summary ? '<p>' + esc(S.summary) + '</p>' : '') + assumptions +
      '</div></div>' +
      '<div class="tree">' + renderNode(S.map, 0) + '</div>' +
    '</div>' +
    inspector() +
    '</div>' + dock() + '</div>';
}

/* ── overlays ─────────────────────────────────────────────── */
function busyCard() {
  return '<div class="stage stage--center"><div class="brief"><div class="card brief__panel loading">' +
    '<div class="eyebrow">Working</div>' +
    '<div class="loading__what">' + esc(S.busy.what) + '…</div>' +
    '<div class="loading__bar"><i></i></div>' +
    '<div class="hint">' + (isLive() ? esc(S.model) + ' · up to 90 seconds · nothing is sent anywhere but Anthropic' : 'replaying a recorded run') + '</div>' +
    '</div></div></div>';
}
function errorCard() {
  return '<div class="card notice notice--error" style="margin:16px auto;max-width:760px">' +
    '<h3>' + esc(S.error.title) + '</h3><p>' + esc(S.error.body) + '</p>' +
    '<div class="notice__acts">' + S.error.actions.map(a => btn(a.act, esc(a.label), { sm: true, primary: a.act === 'retry' })).join('') + '</div>' +
    '</div>';
}
function modal() {
  if (!S.modal) return '';
  if (S.modal.kind === 'settings') {
    return overlay('<h3>Settings</h3>' +
      (LIVE_BLOCKED
        ? '<div class="notice notice--info" style="border:1px solid var(--line);border-radius:8px"><p><strong>Live mode is unavailable in this shared preview.</strong> The viewer blocks outbound API calls, so this session replays recorded runs. To map your own brief, open <code>probe.html</code> from the repo on your own machine and add a key there.</p></div>'
        : '<div class="field"><label for="key">Anthropic API key</label>' +
          '<input id="key" type="password" placeholder="sk-ant-…" value="' + esc(S.apiKey) + '">' +
          '<span class="hint">Kept in this browser only (localStorage) and sent to api.anthropic.com and nowhere else. Leave it empty to stay in recorded mode.</span></div>' +
        '<div class="field"><label for="model">Model</label><select id="model">' +
          MODELS.map(m => '<option value="' + m.id + '"' + (S.model === m.id ? ' selected' : '') + '>' + esc(m.label) + '</option>').join('') +
        '</select></div>') +
      '<div class="modal__acts">' + (LIVE_BLOCKED ? '' : btn('save-settings', 'Save', { primary: true }) + btn('clear-key', 'Forget my key')) +
        btn('close-modal', 'Close') + '</div>' +
      '<div class="hint">Prompt pack ' + PROMPTS.VERSION + ' · this build never sends your brief anywhere except the Anthropic API, and only in live mode.</div>');
  }
  if (S.modal.kind === 'export') {
    const tab = S.modal.tab || 'markdown';
    const body = tab === 'markdown' ? toMarkdown() : tab === 'mermaid' ? toMermaid() : tab === 'json' ? toJson() : tab === 'log' ? toSessionLog() : currentPrompt();
    const tabs = [['markdown', 'Markdown'], ['mermaid', 'Mermaid'], ['json', 'JSON'], ['prompt', 'The prompt used'], ['log', 'Session log']];
    return overlay('<h3>Take it with you</h3>' +
      '<div class="tabs">' + tabs.map(t => '<button class="tab" data-act="export-tab" data-arg="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + '</button>').join('') + '</div>' +
      '<pre>' + esc(body) + '</pre>' +
      '<div class="modal__acts">' + btn('copy-export', 'Copy', { primary: true }) + btn('close-modal', 'Close') + '</div>' +
      '<div class="hint">' + (tab === 'log' ? 'Every edit, vote, skip and failure in this session — the raw material for evaluating the agent.' : tab === 'prompt' ? 'The exact instructions behind this map. Nothing hidden.' : 'Downloads are blocked inside shared previews, so this copies to your clipboard.') + '</div>');
  }
  return '';
}
function overlay(inner) {
  return '<div class="overlay" data-act="close-modal-bg"><div class="card modal" role="dialog" aria-modal="true">' + inner + '</div></div>';
}

/* ── root render ──────────────────────────────────────────── */
function render() {
  const screen = S.busy ? busyCard()
    : S.screen === 'brief' ? screenBrief()
    : S.screen === 'clarify' ? screenClarify()
    : (S.map ? screenMap() : screenBrief());

  app.innerHTML =
    '<div class="app' + (S.screen === 'map' && S.map && !S.busy ? ' app--map' : '') + '">' + topbar() + (S.screen === 'brief' ? trustline() : '') +
    (S.error ? errorCard() : '') +
    '<main class="main">' + screen + '</main>' +
    '<footer class="footbar">' +
      '<span>Probe · prompt pack ' + PROMPTS.VERSION + '</span>' +
      '<span>' + (isLive() ? 'live · ' + esc(S.model) : 'recorded run · no API calls') + '</span>' +
      '<span>model knowledge, not live research</span>' +
      '<span>' + countNodes() + ' nodes · ' + S.log.length + ' session events</span>' +
    '</footer></div>' +
    modal() + (S.toast ? '<div class="toast">' + esc(S.toast) + '</div>' : '');

  if (render._last !== S.screen) { render._last = S.screen; window.scrollTo(0, 0); }

  const editing = app.querySelector('[contenteditable="true"]');
  if (editing) {
    editing.focus();
    const r = document.createRange(); r.selectNodeContents(editing);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }
}
S.dockIndex = 0;
