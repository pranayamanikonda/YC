---
name: handoff
description: Write a session-compaction snapshot so a fresh agent can resume without the prior conversation. Use before context is compacted, when pausing mid-stage, or when handing a project to another agent. Composes Current Status / Next Steps / Suggested Skills / References from the manifest, audit, and wayfinder; you write only the Summary.
disable-model-invocation: true
---

# handoff

The harness already keeps a **ledger** (what happened) and **memory.md** (what's
true now). Handoff is the third piece: a point-in-time **compaction snapshot** that
says where the project stands and what to do next, so a fresh agent — after your
context is compacted, or when the work changes hands — can resume from files alone.

## What it does

Assembles `<project>/.harness/handoff/NNNN.md` with five sections:

- **Conversation Summary** — the one part you write: a few lines on what happened this
  session. (Left as `[[FILL]]` unless you pass `--summary`.)
- **Current Status** — computed from the manifest + audit: tier, mask, per-stage status,
  gates, next stage, audit result, wayfinder frontier, and what's blocking.
- **Next Steps** — the shortest path forward (clear audit errors → resolve the frontier →
  grill + approve the gate → run the next stage).
- **Suggested Skills** — pointers to the skill each next step needs.
- **References** — links to the durable artefacts (memory, wiki home, manifest, ledger)
  and the recent ledger tail. **Referenced, never duplicated** — the artefacts are the
  source of truth.

The whole document is **scrubbed for secrets** (keys, tokens, bearer, private keys,
`password=…`) before it is written, so a compaction doc never carries a live credential.
It is saved under `.harness/` so a commit makes it durable (the container is ephemeral).

## Run

```bash
node prd-harness/skills/handoff/handoff.mjs <projectDir> [--summary "what happened this session"]
```

Or import `{ handoff }` from `handoff.mjs`.

## Resuming from one

A fresh agent reads the **newest** `.harness/handoff/NNNN.md` alongside `memory.md` and
`wiki/home.md`, follows Next Steps, and picks up where the last session stopped — no
conversation history required.
