---
name: wiki
description: The project's LLM-maintained knowledge wiki (Karpathy's compounding-wiki pattern). Use to ingest new/changed sources into interlinked markdown pages, query the wiki before re-deriving anything, and lint it (broken links, missing provenance, stale claims). The wiki is the durable, cross-referenced memory beside memory.md; its lint is folded into the audit and blocks gates.
---

# wiki (LLM-maintained knowledge)

Knowledge **compounds** here instead of being re-derived each session. Three layers:
immutable **raw sources** (`prd/`, `prd/research/`, `assets/`, ledger, stage artefacts) →
the **wiki** (`<project>/wiki/`, interlinked markdown pages) → the **schema**
(`wiki/schema.json`). You synthesize the page content; the engine enforces structure,
provenance, the link graph, and the lint.

## Commands
```bash
node prd-harness/skills/wiki/wiki.mjs index  <projectDir>                 # rebuild the link graph
node prd-harness/skills/wiki/wiki.mjs lint   <projectDir>                 # health check (blocks gates)
node prd-harness/skills/wiki/wiki.mjs ingest <projectDir> --source <path> --type <t> [--page <slug>]
node prd-harness/skills/wiki/wiki.mjs query  <projectDir> <term>          # find pages + backlinks
```
Page types: `entity` (people/systems/services/deps), `decision` (link ADRs), `pattern`,
`gotcha`, `glossary`. Pages live in `wiki/<type>s/` (e.g. `wiki/entities/`).

## The loop (what you own vs. what the engine enforces)
- **Ingest** — `wiki ingest … --source <path> --type <t>` scaffolds a page with a provenance
  entry (`sources: [{path, hash}]`) and a `[[FILL]]` marker. **You then synthesize** the page
  from its source(s): replace `[[FILL]]`, write the durable facts, link related pages with
  `[[wikilink]]` syntax, and keep the `## Sources` citations. Prefer linking over copying.
- **Query** — `wiki query <term>` before re-deriving anything; read the returned pages (and
  their backlinks), not the whole vault.
- **Lint** (enforced, folded into the audit) — a page is rejected when it has a **broken
  wikilink**, **missing frontmatter** (`type`/`updated`/`sources`), cites a **missing source**,
  is **STALE** (a cited source's current sha256 ≠ the recorded hash — re-ingest and
  re-synthesize), or still contains `[[FILL]]`. Orphan pages and unresolved `#contradiction`
  tags warn.

## Discipline
- Every non-home page cites ≥1 raw source; claims trace to sources.
- When a source changes, the page goes STALE — re-ingest (refreshes the hash) and update the
  synthesis. This reuses the same staleness machinery as stage change-propagation.
- Keep `memory.md` (at-a-glance current state) and the wiki (the graph) both current; the
  home page links them.
