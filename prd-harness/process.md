# PRD → Delivery Harness — Process

A committed, reusable **engine**: drop a PRD in, get a structured project out. The harness
plans and creates the folder structure, documents it as real artifacts (Figma, FigJam,
XLSX, DOCX, PDF, PPTX, HTML), and drives the work as a **gated agent pipeline** with the
right specialist called at each stage. One process, run the same way every time.

This file is the contract. It is the source of truth for the stage graph, the gates, the
agent roster, the hand-off protocol, and the artifact-format map. `AGENTS.md` tells an
agent *how to behave*; this file tells it *what the pipeline is*.

## Core idea

The project's operating model is four layers — **Source → Build → Proof → Shared system**:

- **Source** (editable truth) — `prd/PRD.md`, `definition/` acceptance criteria,
  `design/design-system/tokens.md`, specs, configuration, approved decisions.
- **Build** (source → output) — the stage pipeline (`skills/pipeline`, `prd-intake`) that
  scaffolds artefacts, generates the backlog, renders designs, and implements code.
- **Proof** (confirm the output) — the `audit` (consistency + traceability + design-lint),
  the three gates, the reviewers (`code`/`security`/`a11y`), and the G3 Iron-Law verifier.
- **Shared system** (reused every iteration) — `rules/`, `templates/`, the `agents/` roster,
  and `AGENTS.md`, so neither human nor agent reinvents the project each pass.

Four constants hold on every run:

- **PRD is the source of truth.** Everything downstream traces to a normalized `prd/PRD.md`.
- **Docs are the hand-off, and the record.** Each stage writes an artifact + a HANDOFF; every
  meaningful change writes a change record; every ship appends to the ship log. State survives
  compaction in durable files, never chat memory.
- **Gates, not autonomy, at the risky seams.** Three gates (audit + human approval) bound the
  run; work flows freely between them.
- **Author ≠ reviewer.** Whoever produces an artifact never signs off on it. Review is a
  different agent, ideally a different model.

### Folder crosswalk (doc-OS name → this harness)

| Doc-OS role | In this harness |
| ----------- | --------------- |
| `sources/` | `prd/`, `definition/`, `design/design-system/tokens.md` |
| `harnesses/` (rules & contracts) | `prd-harness/rules/`, `agents/`, `AGENTS.md`, `process.md` |
| `scripts/` (build/automation) | `prd-harness/skills/` (`prd-intake`, `pipeline`, `assets-intake`, `sync-rules`) |
| `audits/` (proof) | `pipeline/audit.mjs`, the three gates, `docs/validation-report.md` |
| `generated/` | `design/` outputs, `artifacts/`, `src/` |
| `documentation/` | `docs/`, `memory.md`, `docs/system-overview.md` |
| `ship-log/` | `ship-log.md` + `.harness/ledger/` |

Names are adapted to this project, as the doc-OS itself advises — the roles map 1:1.

## The stage graph

```mermaid
flowchart TD
    PRD([PRD dropped in]) --> S0

    subgraph DISCOVERY
      S0["0 · Intake &amp; Framing<br/>size classifier → phase mask"]
    end
    S0 --> G1{{"G1 · Framing approved?<br/>scope · assumptions · non-goals"}}

    subgraph DEFINITION
      G1 -->|approved| S1["1 · Definition<br/>epics · stories · acceptance criteria"]
    end

    subgraph DESIGN
      S1 --> S2["2 · Information Architecture"]
      S2 --> S3["3 · Workflows"]
      S3 --> S4["4 · Wireframes (lo-fi)"]
      S4 --> S5["5 · Visual Design &amp; System"]
    end
    S5 --> G2{{"G2 · Design approved?<br/>IA · flows · wireframes · direction"}}

    subgraph BUILD
      G2 -->|approved| S6["6 · Engineering<br/>DAG · TDD · author≠reviewer"]
    end
    S6 --> G3{{"G3 · Pre-ship gate<br/>build·type·lint·test·security·diff"}}
    G3 -->|green| S7["7 · Ship &amp; Log"]
    S7 --> DONE([shipped + logged])

    G1 -.->|changes| S0
    G2 -.->|changes| S2
    G3 -.->|red| S6
```

Small PRDs skip stages by phase mask (below); large PRDs run all eight. The dashed edges
are the gate rejection loops.

## Gates

| Gate | After | Human confirms | On reject |
| ---- | ----- | -------------- | --------- |
| **G1** | Stage 0 Framing | Scope, the assumptions-to-confirm list, and non-goals are right | Re-frame (loop to 0) |
| **G2** | Stage 5 Visual | IA + flows + wireframes + the chosen visual direction (2–3 offered) | Revise design (loop to 2–5) |
| **G3** | Stage 6 Eng | The verification report is green with **fresh** evidence (the Iron Law: no completion claim without a fresh run) | Fix (loop to 6) |

Between gates, stages hand off automatically. A gate is the only place the pipeline stops
for a human by default.

**Grill before approving.** At **G1** and **G2**, dispatch `griller` to interrogate the plan
before the human approves — sequentially, one question at a time, facts researched not asked,
each open decision confirmed (see `skills/grilling`). This is the human-in-the-loop counterpart
to `council` (the parallel, automated breaker). **G1 also depends on wayfinding**: for a `large`
or high-ambiguity PRD, an open frontier ticket in `<project>/wayfinder/` fails the audit and
holds G1 shut until the fog is resolved (see **Wayfinding** below).

## Size classifier → phase mask

Stage 0 scores the PRD on three axes and takes the **highest** tier reached on any axis:

- **surface** — how many product areas / screens / services it touches
- **contract-novelty** — new external contracts, data models, or dependencies
- **ambiguity** — how much is assumption vs. stated

| Tier | Phase mask (stages run) | Typical |
| ---- | ----------------------- | ------- |
| `trivial` | 1 → 6 → 7 | copy tweak, one-field change |
| `small` | 1 → (4) → 6 → 7 | one screen, known pattern |
| `standard` | 1 → 2 → 3 → 4 → 6 → 7 | a feature |
| `large` | 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 | a product / major surface |

Security-sensitive or public-API work is forced to **≥ standard** regardless of score. The
resolved tier, mask, and agent assignments are written to `<project>/.harness/manifest.json`.

## Stages, agents, and deliverables

| # | Stage | Owner | Lead agent (+ support) | Deliverable → format |
| - | ----- | ----- | ---------------------- | -------------------- |
| 0 | Intake & Framing | Agent | `product-analyst` (+ `researcher`, `ux-researcher`) | normalized `prd/PRD.md` · `product-brief` → **DOCX** · **design brief** · **personas** · **ecosystem map** → **Figma/FigJam** · research notes → MD |
| 1 | Definition | Shared | `product-manager` (+ `ux-researcher`) | `epics.md` · **`backlog.xlsx`** (epics · stories · AC) · `acceptance-criteria.md` (AC-NNN) · **design principles (DPs)** · **scenarios** |
| 2 | Information Architecture | Agent | `ia-architect` | site/app map + entity model → **FigJam** + mermaid |
| 3 | Task Flows | Agent | `ux-flows` | journeys + task flows incl. empty/error/edge, walked through the **scenarios** → **FigJam/Figma** + mermaid |
| 4 | Wireframes (lo-fi) | Shared | `wireframe-designer` (+ `a11y-reviewer`) | clickable frames → **Figma** + HTML artifacts |
| 5 | Visual Design & System | Shared | `visual-designer` (+ `design-system`, `theme-factory` skills, `a11y-reviewer`) | tokens (light+dark) + hi-fi comps → **Figma** + tokens-in-code · brand guide → **PDF** |
| 6 | Engineering | Agent | `architect` → `implementer` + `test-author` → `code-reviewer` + `security-reviewer` | code + tests + PRs (TDD, author≠reviewer) |
| 7 | Ship & Log | Shared | orchestrator | commit/push · ADRs · changelog · **ship-log** · stakeholder deck → **PPTX/PDF** |

**Ownership taxonomy** (visible on every stage and high-impact decision, so the agent never
silently makes a product/design call): **Agent** — autonomous; **Shared** — agent produces,
human reviews/approves; **User** — needs human judgment; **Automated gate** — a rule (the
audit) decides whether the flow may continue. The three gates are `Automated gate` (audit
runs) **+** `User` (approval); no gate crosses on the audit alone or on approval over a failing
audit.

### Per-stage contract (input · action · output · validation · failure · recovery)

| Stage | Input | Action | Output | Validation rule | Failure → recovery |
| ----- | ----- | ------ | ------ | --------------- | ------------------ |
| 1 Definition | `prd/PRD.md` | decompose into epics/stories/AC | AC-NNN, backlog, DPs, scenarios | every requirement → ≥1 AC; no placeholders | missing AC → re-run definition |
| 2 IA | PRD + AC | map surfaces/entities/nav | IA map + ecosystem | landmark/nav/focus order present | gap → revise IA |
| 3 Task Flows | AC + IA + scenarios | design journeys incl. edge states | flows | empty/error/edge covered; no colour-only | missing state → add it |
| 4 Wireframes | IA + flows | lay out clickable frames | wireframes | reading order, target sizes, labels; a11y audit | a11y blocker → fix before G2 |
| 5 Visual | wireframes + DPs | direction + tokens (light/dark) | visual + tokens | contrast, focus, states, responsive (design-lint) | lint fail → correct tokens/states |
| 6 Engineering | AC + wireframes + visual | WorkUnit DAG, name the testing seam, TDD | code + tests | exec-plan names one testing seam; each AC → ≥1 test through it; author≠reviewer | red → fix loop (≤3) → breaker |
| 7 Ship | verified build | commit/push, record | ship-log + changelog + ADRs | G3 verdict READY; audit clean | not ready → back to 6 |

Cross-cutting agents: **`council`** (architect + skeptic + pragmatist + critic, fresh
parallel subagents) for any go/no-go decision; **`griller`** (sequential human-in-the-loop
gate interrogation at G1/G2); **`verifier`** owns the G3 report; **`a11y-reviewer`** audits
every design artefact against WCAG 2.2 AA (author ≠ reviewer).

## UX/UI design artefacts (Figma-drafted)

The design track produces a fixed set of artefacts, each **drafted in Figma / FigJam**
(fallback: HTML artifact or mermaid in-repo when Figma is unavailable), each carrying two
mandatory annotations: a **Rationale** ("why this decision, what was rejected") and an
**Accessibility** note. All Figma/FigJam URLs are recorded in `design/figma-links.md`.

| # | Artefact | Stage | Figma form | In-repo home | Accessibility focus |
| - | -------- | ----- | ---------- | ------------ | ------------------- |
| 1 | **Design brief** | 0 | Figma page / FigJam | `design/brief.md` | audience, constraints, a11y target (WCAG 2.2 AA) stated up front |
| 2 | **Personas** | 0 | FigJam board | `design/personas.md` | include assistive-tech users, low-vision, motor, cognitive load |
| 3 | **Ecosystem map** | 0 | FigJam diagram | `design/ia/ecosystem.md` | surfaces, actors, data + trust boundaries |
| 4 | **Design principles (DPs)** | 1 | Figma page | `design/principles.md` | one principle explicitly names accessibility/inclusion |
| 5 | **Scenarios** | 1 | FigJam / Figma | `design/scenarios.md` | at least one scenario is keyboard-only / screen-reader |
| 6 | **Information architecture** | 2 | FigJam map | `design/ia/` | landmark/heading structure, nav order, focus order |
| 7 | **Task flows** | 3 | FigJam / Figma | `design/flows/` | error/empty/edge states; no colour-only signals |
| 8 | **Wireframes** | 4 | Figma frames | `design/wireframes/` | reading order, target sizes, labels, contrast placeholders |
| 9 | **Visual design + system** | 5 | Figma + tokens | `design/visual/`, `design/design-system/` | contrast ratios, focus states, dark+light parity, motion-reduce |
| 10 | **Rationale log** | 0–5 | annotations + doc | `design/decisions.md` | each design decision: why, alternatives, a11y impact |

**Rationale is not optional.** Every artefact and every non-trivial design decision records a
short rationale (what/why/what-was-rejected) in `design/decisions.md` and inline on the
Figma node. **Accessibility is a first-class acceptance criterion**, not a late audit: the
design brief sets the WCAG 2.2 AA target, each artefact carries its a11y note, `a11y-reviewer`
audits at Stages 4 and 5, and G2 will not pass on an artefact with unresolved a11y blockers.
See `rules/common/accessibility.md`.

## The loop / graph model, precisely

- **Outer graph** — the 8 stages above, linear with the 3 gate loops. Deterministic: a
  given PRD + tier always visits the same stages.
- **Inner refine loop** (per stage) — produce → review → fix, bounded to `N` rounds
  (default 3). At the cap, escalate to a more capable model or invoke `council` as a
  "breaker" to adjudicate rather than looping forever.
- **DAG within Stage 6** — the architect decomposes into `WorkUnit`s (`id`, `deps[]`,
  `acceptance[]`, `tier`); units group into dependency **layers**; a layer runs in parallel
  (isolated worktrees when available), each unit passing through its own
  research→implement→test→review pipeline whose depth scales with the unit's tier. A merge
  queue rebases/tests/lands or evicts-with-conflict-context. The reviewer of a unit is never
  its implementer.
- **Ledger** — `<project>/.harness/ledger/<project>.md` is append-only. Every stage
  transition, gate decision, and refine round is recorded so a fresh agent (post-compaction)
  can resume cold.
- **Memory** — `<project>/memory.md` is the curated *current state* (confirmed facts, key
  decisions, entities, open threads). The ledger says what happened; memory says what is true
  now. Read it first each session; keep it current.
- **Handoff (compaction)** — before context is compacted (or when work changes hands),
  `skills/handoff` writes a snapshot to `<project>/.harness/handoff/NNNN.md`: an agent-written
  **Conversation Summary** plus **Current Status / Next Steps / Suggested Skills / References**
  computed deterministically from the manifest, audit, and wayfinder. It is secret-scrubbed and
  *references* artefacts rather than copying them. A resuming agent reads the newest one beside
  `memory.md` and `wiki/home.md`. See `skills/handoff`.
- **Knowledge wiki** — `<project>/wiki/` is an **LLM-maintained, compounding** knowledge base
  (Karpathy's wiki pattern): immutable raw sources (`prd/`, research, assets, ledger) → the
  interlinked wiki → a schema. Operations: **Ingest** a source into a page (with provenance),
  **Query** before re-deriving, **Lint** for health. The **Lint is folded into the audit** —
  broken `[[wikilinks]]`, missing provenance, and **stale** pages (a cited source's sha256
  changed, reusing the change-propagation hash) block the next gate. The agent synthesizes page
  content; the engine enforces structure, the link graph, and the lint. See `skills/wiki`.
- **Wayfinding** — for a `large` or high-ambiguity PRD, intake scaffolds `<project>/wayfinder/`:
  a **map** (destination · notes · decisions · fog · out-of-scope) and **tickets** (one
  investigation per open question — research / prototype / grilling / task — each blocking the
  destination or another ticket). Its **lint is folded into the audit**: an open *frontier*
  ticket (one that blocks the destination) fails the audit and holds **G1** shut until it is
  resolved or moved out of scope. Chart the fog, resolve the frontier, then enter Stage 1.
  See `skills/wayfinder`.
- **Assets** — attached files are ephemeral until ingested into `<project>/assets/` (content-
  hashed, indexed in the manifest) via `assets-intake`. Storage & durability — what survives,
  and where PRDs live — are documented in [`STORAGE.md`](./STORAGE.md).
- **Design-system proof** — Stage 5 emits `design/design-system/tokens.json` (DTCG 2025.10),
  validated deterministically by `skills/pipeline/tokens.mjs`: structural validity, the
  primitive → semantic → component tier model (tier leakage / upward refs error), intent-based
  naming, theme coverage across `$themes`, and WCAG contrast on declared pairs. Token errors
  block the gate like any audit error. `tokens.md` remains human prose beside it.
- **Audit & change-propagation** — a consistency + traceability audit runs before every gate
  (and thus before ship) and on demand. Each stage records a hash of its inputs on completion;
  editing an upstream artefact flags the dependent downstream stages `stale`. Policy: **flag +
  block ship, never auto-rewrite** — a stale or inconsistent project cannot cross the next gate
  even if approved, and the fix is to re-run only the affected stages. Run
  `pipeline/run.mjs audit <project>` anytime.
- **Self-improvement** — friction and gate-rejections can propose harness changes, but only
  behind an explicit `$improve-harness` invocation; never speculative.

## Hand-off protocol

Every stage ends by writing, to the ledger and to its output artifact's frontmatter, a
**HANDOFF** block:

```
HANDOFF
  from: <stage>
  status: ready | needs-decision | blocked
  produced: [<artifact paths>]
  assumptions_to_confirm: [...]     # only if any remain open
  next: <stage or GATE>
```

`ready` advances; `needs-decision` routes to `council` or a gate; `blocked` stops with the
reason. The next stage's first act is to read the prior HANDOFF and the named artifacts —
not the chat.

## Artifact → format map (and honest fallbacks)

| Deliverable | Primary format | Mechanism | Fallback |
| ----------- | -------------- | --------- | -------- |
| PRD, product brief | DOCX / MD | `docx` skill; Drive `create_file` for a Google Doc | MD in repo |
| Research notes | MD | in-repo | — |
| Backlog (epics·stories·AC) | **XLSX** | `xlsx` skill | MD table |
| IA map | **FigJam** | Figma `generate_diagram` / `get_figjam` | mermaid in repo |
| Workflows | **FigJam / Figma** | Figma MCP | mermaid in repo |
| Wireframes | **Figma** | Figma `create_new_file` / `use_figma` | HTML artifacts |
| Design system + hi-fi comps | **Figma** + tokens-in-code | Figma + `design-system` / `theme-factory` | HTML artifacts + tokens |
| Brand guide | PDF | `pdf` skill | MD |
| Stakeholder deck | PPTX / PDF | `pptx` / `pdf` skills | MD |
| Charts / dashboards | HTML / PNG | `dataviz` skill | — |

**Honesty rule:** Google Docs/Sheets are create/read/copy only here (no rich in-doc or
cell editing), so spreadsheets default to local **XLSX** and heavy docs to **DOCX**;
Google versions are offered as a convenience copy, not the source. When a design tool is
unavailable, the stage falls back to mermaid + HTML and the run still completes — the
`figma-links.md` file records whichever coordinates exist.

## What this repo ships (first slice)

`process.md` (this file) · `AGENTS.md` + rules + agent definitions · the `prd-intake`
scaffolder and templates (incl. the `backlog.xlsx` generator) · a worked Stage 0→1 example.
Stages 2–7 are specified here and land as skill bodies stage-by-stage. See `README.md`.

## Prior art

The pipeline synthesizes patterns from repository-harness, superpowers, qm, and ECC. The
front-of-pipeline additions — **wayfinder** (investigation-ticket planning), **grilling**
(sequential gate interrogation), **handoff** (session compaction), and the single **testing
seam** — are adapted from [`mattpocock/skills`](https://github.com/mattpocock/skills); its
`writing-great-skills` conventions inform `rules/common/authoring.md`.
