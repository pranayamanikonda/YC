# Probe — an AI mind-map agent

**Try it:** https://claude.ai/code/artifact/5c8f55e2-cd7c-492d-abe0-f648f685119c
**Week-1 write-up:** https://claude.ai/code/artifact/f88435e6-88e3-4516-8c14-09bd3673a441 ([source](docs/week1-assignment.md))

Probe turns a brief into a map in one step, then argues with its own map on screen —
naming alternative framings, flagging the assumptions each branch rests on, and asking
the questions whose answers would change it. Nothing blocks: answer a question and the
map is reworked in place, skip it and it becomes a visible assumption, ignore it and
the map is still yours to edit.

Built for Problem Statement 2 of the human-centred AI design course project.

## Running it

Nothing to install. `probe.html` is one self-contained file.

```bash
# recorded mode — works anywhere, including by double-clicking the file
open probe.html

# live mode — your own brief, your own Anthropic key
python3 -m http.server 8000     # file:// pages cannot call the API
# then open http://localhost:8000/probe.html and add your key under Settings
```

| Mode | What it does | When you get it |
| --- | --- | --- |
| **Recorded** | Replays saved outputs of the prompt pack for three briefs, including a scripted effect for every clarifying question. No network, no key. | Default, and the only mode in the shared artifact link — artifact pages are blocked from calling external APIs. |
| **Live** | Sends your brief to `api.anthropic.com` with your key and maps whatever you type. | When you serve the file yourself and add a key in Settings. The key lives in your browser's localStorage and goes nowhere else. |

Everything after generation — editing, locking, deleting, undo, diff highlighting,
feedback, exports — is local and identical in both modes.

## Layout

```text
probe.html                 the built agent (generated — edit src/, then run build.sh)
build.sh                   cats src/ into probe.html; no bundler, no dependencies
src/
  00-head.html             title + Google Fonts
  10-styles.css            design tokens and layout
  20-prompts.js            the agent's prompt pack — the actual configuration
  30-recorded.js           three recorded runs of those prompts
  40-app.js                state, model calls, retries, validation, diffing, exports
  50-view.js               rendering
  60-events.js             interaction
test/flow.test.mjs         35 end-to-end checks in headless Chromium
evals/cases.md             evaluation set and rubric for Week 2
docs/week1-assignment.md   the Week-1 submission (source of truth)
docs/build-doc.py          renders that markdown into the published page
docs/week1-assignment.html generated — do not edit by hand
CHANGELOG-agent.md         prompt-pack version history
```

## Verifying a change

```bash
sh build.sh
node test/flow.test.mjs     # needs playwright + chromium available
```

The test walks brief → clarify → map → refine, exercises editing, undo, locking,
exports and the three failure paths, and fails if the page logs an error.
