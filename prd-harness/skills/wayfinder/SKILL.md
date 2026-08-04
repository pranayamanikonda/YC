---
name: wayfinder
description: Chart a large or foggy effort as a Map + investigation tickets before running the pipeline. Use when a PRD is too big or too uncertain for one pass — turn open questions into tickets that block the destination, resolve the frontier, then enter Stage 1.
disable-model-invocation: true
---

# wayfinder

Some PRDs are too large or too foggy to run straight down the stage graph — the
shape isn't known yet. Wayfinding is what you do first: name the **destination**,
list what's known, and turn every open question into an **investigation ticket**.
Resolve the tickets that block the destination and the fog clears enough to commit
to Stage 1. prd-intake scaffolds a map automatically for `large` (or high-ambiguity)
PRDs; run it by hand any time an effort outgrows a single pass.

## Model

- **`wayfinder/map.md`** — Destination · Notes · Decisions so far · Not yet specified
  (fog) · Out of scope.
- **`wayfinder/tickets/WF-NNN.md`** — one investigation. Frontmatter `id, type
  (research | prototype | grilling | task), status (open | claimed | resolved |
  out-of-scope), blocks (destination | WF-NNN)`; body **Question** + **Resolution**.

A ticket that `blocks: destination` is on the **frontier**. Tickets can also block
each other, forming a small dependency graph. `grilling`-type tickets hand off to
the `griller` agent (see `skills/grilling`).

## The rule with teeth

`wayfinder lint` folds into the pipeline **audit**. While any frontier ticket is
still `open`/`claimed`, the audit fails and the project **cannot cross G1** — even
if G1 is approved. Resolve it (record the answer, set `status: resolved`) or decide
it doesn't matter (`status: out-of-scope`), and the gate opens. Broken `blocks`
references and missing frontmatter are errors too; a ticket adrift from the graph is
a warning.

## Run

```bash
node prd-harness/skills/wayfinder/wayfinder.mjs chart   <projectDir> --destination "<one line>"
node prd-harness/skills/wayfinder/wayfinder.mjs ticket  <projectDir> --type research --question "<q>" [--blocks destination|WF-002]
node prd-harness/skills/wayfinder/wayfinder.mjs resolve <projectDir> WF-001 --resolution "<answer>"
node prd-harness/skills/wayfinder/wayfinder.mjs status  <projectDir>
node prd-harness/skills/wayfinder/wayfinder.mjs lint    <projectDir>
```

Or import `{ chart, ticket, resolve, status, lint }` from `wayfinder.mjs`.

## Working the map

1. `chart` the destination, then fill the Notes / Decisions / fog sections of the map.
2. For each fog item, open a ticket (`--blocks destination`, or `--blocks WF-NNN` when
   one question depends on another). Keep each to about one session's worth of work.
3. Resolve or scope-out the frontier. When `status` shows an empty frontier and `lint`
   is clean, hand off to Stage 1 — the map's Decisions become the definition's inputs.
