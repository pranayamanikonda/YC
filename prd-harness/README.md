# PRD → Delivery Harness

Drop a PRD in; get a structured, documented project out. This is the reusable **engine**
that plans and creates the project folder structure, produces the deliverables (Figma,
FigJam, XLSX, DOCX, PDF, PPTX, HTML), and drives the work as a **gated agent pipeline** —
the same way every time.

- **[`process.md`](./process.md)** — the pipeline: the 8-stage graph, 3 human gates, inner
  loops, the agent roster, the UX/UI design-artefact register, and the artifact→format map.
- **[`AGENTS.md`](./AGENTS.md)** — the agent protocol (how to behave). `CLAUDE.md` symlinks
  to it; `.cursor/rules/*.mdc` are generated from it — one source, both harnesses.

## Quick start

```bash
# Stage 0 — scaffold a project from a PRD (then it stops at gate G1).
node prd-harness/skills/prd-intake/scaffold.mjs prd-harness/examples/sample-prd/PRD.md ./out
P=./out/team-standup-digest

# Stages 1–7 — drive the pipeline; it stops at gates and unfinished stages.
node prd-harness/skills/pipeline/run.mjs status  "$P"
node prd-harness/skills/pipeline/run.mjs approve "$P" G1   # record human gate approval
node prd-harness/skills/pipeline/run.mjs advance "$P"      # run until blocked

# regenerate Cursor rules after editing AGENTS.md or rules/
node prd-harness/skills/sync-rules/sync.mjs

# tests (from repo root)
npm test
```

## The pipeline

```
PRD → [0 Intake&Framing] –G1→ [1 Definition] → [2 IA] → [3 Task Flows] → [4 Wireframes]
                                                                              → [5 Visual] –G2→
      [7 Ship&Log] ←G3– [6 Engineering] ←──────────────────────────────────────────────┘
```

A **size classifier** at Stage 0 picks a phase mask (`trivial|small|standard|large`), so a
small PRD skips design stages and a large one runs all eight. Three human gates bound the
run; work flows freely between them. **Author ≠ reviewer** throughout. State lives in files
(a durable ledger), not conversation memory.

## UX/UI design artefacts

The design track produces, each **drafted in Figma/FigJam** (fallback: HTML/mermaid) with a
mandatory **Rationale** and **Accessibility** note: design brief · personas · ecosystem map ·
design principles · scenarios · information architecture · task flows · wireframes · visual
design + system · a running decision/rationale log. Accessibility targets **WCAG 2.2 AA**,
is designed in from Stage 0, and is audited by `a11y-reviewer` before G2. See
[`rules/common/accessibility.md`](./rules/common/accessibility.md).

## Layout

```
prd-harness/
  process.md          the pipeline (graph · gates · loops · roster · format map)
  AGENTS.md           agent protocol   (CLAUDE.md → symlink; .cursor/rules generated)
  rules/common/       workflow · git · testing · security · review · design · accessibility
  agents/             16 specialist definitions (name·description·tools·model)
  skills/
    prd-intake/       Stage-0 scaffolder + size classifier + dependency-free xlsx writer
    pipeline/         Stages 1–7 runner (declarative STAGE_SPEC · gates · hand-off)
    sync-rules/       regenerate .cursor/rules from the canonical source
  templates/          PRD · product-brief · epics · acceptance-criteria · design-brief ·
                      personas · decisions · ADR · exec-plan · validation-report
  hooks/              SessionStart bootstrap
  manifests/          phase profiles (size → mask → stage leads)
  examples/sample-prd A worked PRD (Team Standup Digest)
```

## Status

All eight stages are runnable. Stage 0 (`prd-intake`) scaffolds and classifies; Stages 1–7
(`pipeline`) scaffold each stage's artefact homes, enforce sequencing and the three gates,
validate structural completion, and write the HANDOFF — the agent fills the creative content
between runs, and human approval crosses each gate. Covered by `npm test` (79 tests,
including a full end-to-end run through G1/G2/G3). The Figma drafting of design artefacts is
performed live via the Figma MCP, driven by the design-stage specs.
