/* ─────────────────────────────────────────────────────────────
   Probe — event wiring
   ───────────────────────────────────────────────────────────── */

let lastCall = null;
function invoke(fn) { lastCall = fn; return fn(); }

function val(sel) { const el = app.querySelector(sel); return el ? el.value : ''; }

/* typing updates state without a re-render, so focus is never stolen */
app.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.bind) {
    S.brief[t.dataset.bind] = t.value;
    return;
  }
  if (t.dataset.bindAnswer) {
    const qid = t.dataset.bindAnswer;
    S.answers[qid] = { answer: t.value, skipped: false };
    return;
  }
});

app.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.probeInput) {
    const [id, i] = e.target.dataset.probeInput.split(/-(?=\d+$)/);
    answerProbe(id, Number(i), e.target.value);
    e.preventDefault();
  }
  if (e.key === 'Enter' && e.target.hasAttribute('data-dock-input')) {
    const b = app.querySelector('[data-act="dock-answer"]');
    if (b) b.click();
    e.preventDefault();
  }
  if (e.key === 'Enter' && e.target.isContentEditable) { e.target.blur(); e.preventDefault(); }
  if (e.key === 'Escape') {
    if (S.modal) { S.modal = null; render(); }
    else if (S.editingId) { S.editingId = null; render(); }
  }
});

app.addEventListener('blur', e => {
  if (e.target.dataset && e.target.dataset.edit) {
    const id = e.target.dataset.edit;
    const node = findNode(id);
    const text = e.target.textContent.trim();
    if (node && text && text !== node.label) {
      snapshot();
      logEvent('node_renamed', { node: id, from: node.label, to: text });
      node.label = text; node.source = 'user'; node.status = 'changed';
    }
    S.editingId = null;
    render();
  }
}, true);

function answerProbe(nodeId, index, answer) {
  const node = findNode(nodeId);
  if (!node || !answer || !answer.trim()) { toast('Write an answer first'); return; }
  const question = (node.probes || [])[index];
  node.answeredProbes = (node.answeredProbes || []).concat([index]);
  invoke(() => refine(nodeId, question, answer.trim()));
}

app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  const arg = el.dataset.arg;
  const node = id ? findNode(id) : null;

  switch (act) {
    /* ── brief ── */
    case 'example': {
      const c = recordedCase(arg);
      S.brief = clone(c.brief); S.caseId = c.id;
      logEvent('example_chosen', { case: c.id });
      toast('Loaded the recorded brief — now ask for questions');
      return render();
    }
    case 'start': {
      if (!S.caseId || S.brief.topic !== (recordedCase(S.caseId) || {}).brief?.topic) {
        const match = RECORDED.filter(c => c.brief.topic === S.brief.topic)[0];
        S.caseId = match ? match.id : null;
      }
      return invoke(startFlow);
    }

    /* ── clarify ── */
    case 'sugg': {
      const q = S.questions.filter(x => x.id === arg)[0];
      const pick = q.suggestions[Number(el.dataset.i)];
      const cur = (S.answers[arg] || {}).answer;
      S.answers[arg] = { answer: cur === pick ? '' : pick, skipped: false };
      return render();
    }
    case 'skip': S.answers[arg] = { answer: '', skipped: true }; logEvent('question_skipped', { q: arg }); return render();
    case 'unskip': S.answers[arg] = { answer: '', skipped: false }; return render();
    case 'skip-all':
      S.questions.forEach(q => { if (!(S.answers[q.id] || {}).answer) S.answers[q.id] = { answer: '', skipped: true }; });
      logEvent('question_skipped', { all: true });
      return render();
    case 'build': return invoke(buildMap);
    case 'back-to-brief': S.screen = 'brief'; return render();

    /* ── map: navigation ── */
    case 'select': S.selectedId = id; return render();
    case 'toggle': node.collapsed = !node.collapsed; return render();
    case 'dock-jump': S.selectedId = id; render();
      { const t = app.querySelector('[data-node="' + id + '"]'); if (t) t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      return;
    case 'dock-next': S.dockIndex++; return render();
    case 'clear-diff': clearDiff(); S.changeNote = ''; return render();

    /* ── map: editing ── */
    case 'edit': S.editingId = id; return render();
    case 'add-child': {
      snapshot();
      const child = { id: newId('u'), label: 'New node', why: 'Added by you.', confidence: 'high', source: 'user', alternatives: [], probes: [], children: [], status: 'added' };
      node.children = (node.children || []).concat([child]);
      node.collapsed = false;
      S.selectedId = child.id; S.editingId = child.id;
      logEvent('node_added', { parent: id });
      return render();
    }
    case 'delete': {
      if (node === S.map) { toast('The centre of the map cannot be deleted'); return; }
      snapshot();
      const p = findParent(id);
      p.children = p.children.filter(c => c.id !== id);
      logEvent('node_deleted', { node: id, label: node.label });
      S.selectedId = p.id;
      toast('Deleted — undo is in the top bar');
      return render();
    }
    case 'lock': node.locked = !node.locked; logEvent('node_locked', { node: id, locked: node.locked }); return render();
    case 'vote-up': case 'vote-down': {
      const v = act === 'vote-up' ? 1 : -1;
      node.vote = node.vote === v ? 0 : v;
      logEvent('feedback', { node: id, label: node.label, vote: node.vote });
      toast(node.vote === 1 ? 'Marked useful' : node.vote === -1 ? 'Marked generic — saved for the next round' : 'Feedback cleared');
      return render();
    }
    case 'swap-alt': {
      snapshot();
      const alt = node.alternatives[Number(arg)];
      logEvent('alternative_taken', { node: id, from: node.label, to: alt.label });
      node.label = alt.label; node.why = 'You chose this framing over the original. Trade-off: ' + alt.tradeoff;
      node.source = 'user'; node.confidence = 'high'; node.status = 'changed';
      return render();
    }
    case 'deepen': return invoke(() => deepen(id));

    /* ── map: refine ── */
    case 'answer-probe': return answerProbe(id, Number(arg), val('[data-probe-input="' + id + '-' + arg + '"]'));
    case 'dock-answer': return answerProbe(id, Number(arg), val('[data-dock-input]'));

    /* ── history ── */
    case 'undo': {
      if (!S.history.length) return;
      S.future.push({ map: clone(S.map), assumptions: clone(S.assumptions), changeNote: S.changeNote });
      const prev = S.history.pop();
      S.map = prev.map; S.assumptions = prev.assumptions; S.changeNote = prev.changeNote;
      logEvent('undo', null);
      toast('Reverted');
      return render();
    }
    case 'redo': {
      if (!S.future.length) return;
      S.history.push({ map: clone(S.map), assumptions: clone(S.assumptions), changeNote: S.changeNote });
      const next = S.future.pop();
      S.map = next.map; S.assumptions = next.assumptions; S.changeNote = next.changeNote;
      return render();
    }

    /* ── chrome ── */
    case 'export': S.modal = { kind: 'export', tab: 'markdown' }; return render();
    case 'export-tab': S.modal.tab = arg; return render();
    case 'copy-export': {
      const t = S.modal.tab;
      return copy(t === 'markdown' ? toMarkdown() : t === 'mermaid' ? toMermaid() : t === 'json' ? toJson() : t === 'log' ? toSessionLog() : currentPrompt());
    }
    case 'settings': S.error = null; S.modal = { kind: 'settings' }; return render();
    case 'save-settings': {
      S.apiKey = val('#key').trim(); S.model = val('#model');
      LS.set('key', S.apiKey); LS.set('model', S.model);
      S.modal = null;
      toast(S.apiKey ? 'Live mode on — your brief goes to Anthropic only' : 'Recorded mode');
      return render();
    }
    case 'clear-key': S.apiKey = ''; LS.del('key'); S.modal = null; toast('Key forgotten'); return render();
    case 'close-modal': S.modal = null; return render();
    case 'close-modal-bg': if (e.target.classList.contains('overlay')) { S.modal = null; render(); } return;
    case 'theme': {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
      if (next) document.documentElement.setAttribute('data-theme', next);
      else document.documentElement.removeAttribute('data-theme');
      LS.set('theme', next);
      return;
    }
    case 'restart': {
      if (S.map && !confirm('Start a new map? The current one is not saved anywhere.')) return;
      S.screen = 'brief'; S.map = null; S.questions = []; S.answers = {}; S.history = []; S.future = [];
      S.refineRound = 0; S.changeNote = ''; S.selectedId = null; S.assumptions = []; S.caseId = null;
      logEvent('restart', null);
      return render();
    }

    /* ── failure recovery ── */
    case 'dismiss': S.error = null; return render();
    case 'retry': S.error = null; render(); return lastCall ? invoke(lastCall) : null;
    case 'to-brief': S.error = null; S.screen = 'brief'; return render();
    case 'jump-recorded': {
      S.error = null;
      const c = recordedCase(S.caseId);
      const r = c && c.refinements && c.refinements[0];
      if (r) { S.selectedId = r.probeId; S.dockIndex = 0; }
      return render();
    }
  }
});

/* restore the viewer's last explicit theme choice, if any */
(function boot() {
  const t = LS.get('theme', '');
  if (t) document.documentElement.setAttribute('data-theme', t);
  logEvent('session_start', { mode: isLive() ? 'live' : 'recorded', blocked: LIVE_BLOCKED, promptVersion: PROMPTS.VERSION });
  render();
})();
