# Storage & durability

Where PRDs, documents, assets, and outputs live — and, crucially, **what survives**.

## The one rule

The execution container is **ephemeral**: it is reclaimed when the session ends or goes
idle. The upload area, the scratchpad, and any uncommitted working files vanish with it.
**Only two things persist:**

1. What is **committed to git and pushed** (→ GitHub).
2. What lives in an **external service** (Figma, Google Drive).

Everything else is temporary.

## Where each input goes

| Input | Lands at | Durable? | To keep it |
| ----- | -------- | -------- | ---------- |
| Attached file | `/root/.claude/uploads/<session>/…` (container) | No | Ingest into `<project>/assets/` |
| Pasted PRD text | The conversation | No | Written to `<project>/prd/PRD.md`, then committed |
| Scaffolded project | wherever `outDir` points | Only if inside the repo AND committed | Commit + push |
| Figma design | Figma (your team) | Yes (Figma) | URL recorded in `design/figma-links.md` |
| Google Doc/Sheet | Google Drive | Yes (Drive) | Link recorded alongside the artefact |

## Per-project layout (what is stored where)

```
<project>/
  prd/PRD.md              normalized PRD — source of truth (committed)
  prd/research/           research notes
  definition/             epics · backlog.xlsx · acceptance criteria
  design/                 brief · personas · IA · flows · wireframes · visual · tokens
  design/figma-links.md   canonical URLs for external (Figma/Drive) artefacts
  assets/                 ingested source files (logos, brand, reference PDFs) — content-hashed
  artifacts/              exported deliverables (PDF/PPTX/DOCX/PNG)
  docs/                   ADRs · plans · runbooks · validation report
  memory.md               durable curated CURRENT STATE (read first; keep updated)
  .harness/
    manifest.json         tier · phase mask · gates · capabilities · assets[] index
    ledger/<slug>.md      append-only EVENT LOG (what happened, in order)
```

**memory vs ledger.** `memory.md` is the curated *current state* a fresh agent reads to
resume; `.harness/ledger/*.md` is the append-only *history*. Update memory when facts change;
never rewrite the ledger.

## Assets

Attached files are ephemeral until ingested. `assets-intake` copies them into
`<project>/assets/`, content-hashes them, and records them in `manifest.assets[]`:

```bash
node prd-harness/skills/assets-intake/ingest.mjs <projectDir> <file...>
```

Small text/binaries live in `assets/` (durable via git). For **large binaries**, prefer a
Figma/Drive link recorded in `design/figma-links.md` — git is a poor blob store.

## Choosing where PRDs live (privacy)

Committing a PRD pushes it to the GitHub repo. Pick per project:

- **Git in this repo** — simplest; the PRD and all artefacts are versioned together. Fine for
  non-sensitive work. Confirm the repo's visibility (public vs private) first.
- **Private repo** — same workflow, restricted audience.
- **Drive-only source** — keep the sensitive PRD in Google Drive; commit only derived,
  shareable artefacts. Record the Drive link in `memory.md`.

Default is git-in-repo unless you say otherwise. Nothing sensitive is pushed without that
being the agreed location.
