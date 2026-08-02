---
name: pipeline
description: Runs Stages 1–7 of the PRD harness. Use after prd-intake and G1 approval to drive a scaffolded project stage by stage — scaffolding each stage's artefact homes, checking completion, enforcing the gates, and writing the HANDOFF. Handles definition, IA, task flows, wireframes, visual design, engineering, and ship.
---

# pipeline (Stages 1–7)

Drives a project the intake scaffolder created. One runner executes every stage from a
declarative spec (`stage.mjs` › `STAGE_SPEC`), so sequencing, gates, and hand-offs are
identical across stages.

## Commands
```bash
node prd-harness/skills/pipeline/run.mjs status  <projectDir>
node prd-harness/skills/pipeline/run.mjs advance <projectDir>            # run until blocked
node prd-harness/skills/pipeline/run.mjs approve <projectDir> <G1|G2|G3> # record human approval
node prd-harness/skills/pipeline/run.mjs audit   <projectDir>            # consistency + staleness
```

## Audit & change-propagation
The **audit** checks the whole project is coherent — no leftover `[[FILL]]` in a done stage,
indexed assets exist, gate state matches stage state, acceptance criteria present, engineering
has tests — and detects **staleness**. Each stage records a hash of its inputs on completion
(`stageInputs`); if you edit an upstream artefact after a downstream stage is done, that stage
and everything downstream are flagged `stale`.

Policy: **flag + block ship, never auto-rewrite.** The audit runs automatically before every
gate (and thus before ship); a stale or inconsistent project cannot cross a gate **even if the
gate is approved**. To clear staleness, re-run the affected stages (that re-records their
inputs). Run `audit` on demand anytime.

## How a stage runs
1. **Sequencing** — every earlier masked stage must be `done`.
2. **Gate** — a gate before the stage (G1→Definition, G2→Engineering, G3→Ship) must be
   human-approved, recorded via `approve`.
3. **Scaffold** — missing artefact homes are written as stubs carrying a `[[FILL]]`
   sentinel and, for design artefacts, **Rationale** + **Accessibility** sections.
4. **Validate** — a stage completes only when its artefacts exist, match their required
   marker, and contain no `[[FILL]]` or leftover placeholder.
5. **Hand off** — on completion the stage is marked `done` and a HANDOFF is written to the
   ledger naming the next stage or gate.

`advance` loops steps 1–5 until it hits a gate, an unfinished stage, or the end.

## The agent's job per stage (what the runner cannot do for you)
- **1 Definition** — fill `acceptance-criteria.md` (real AC-NNN), `design/principles.md`
  (one names accessibility), `design/scenarios.md` (one keyboard-only / screen-reader).
- **2 IA** — `design/ia/ia-map.md` (site map, nav, focus order) + `ecosystem.md` (actors,
  trust boundaries). Draft in FigJam; keep mermaid in-repo; record URLs in `figma-links.md`.
- **3 Task Flows** — `design/flows/flows.md`: journeys incl. empty/error/edge; no
  colour-only signals.
- **4 Wireframes** — `design/wireframes/index.md`: clickable frames, reading order, target
  sizes. `a11y-reviewer` audits.
- **5 Visual** — `design/visual/visual-design.md` + `design/design-system/tokens.md`:
  direction, light+dark tokens, contrast, focus, motion-reduce. `a11y-reviewer` audits.
  Then **G2**.
- **6 Engineering** — `docs/plans/active/exec-plan.md` (WorkUnit DAG); implement TDD with
  author ≠ reviewer. Then **G3** (`verifier` runs the validation report).
- **7 Ship** — `docs/validation-report.md` (verdict READY) + `CHANGELOG.md`; commit/push.

Fill the artefacts, then re-run `advance` to validate and move on. Never cross a gate
without human approval; never claim a stage done while its checks fail.
