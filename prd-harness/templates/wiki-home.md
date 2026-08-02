---
type: home
title: home
updated: "{{date}}"
sources:
  - path: memory.md  hash: null
tags: []
---

# {{title}} — Wiki

The compounding knowledge base for this project (Karpathy's LLM-maintained-wiki pattern).
Knowledge is **ingested** here once and reused, not re-derived each session.

- **Current state at a glance:** `../memory.md` (this page's cited source).
- **Sources** (immutable, cited never rewritten): `prd/`, `prd/research/`, `assets/`,
  `.harness/ledger`, stage artefacts.
- **This wiki** (LLM-maintained): entities · decisions · patterns · gotchas · glossary.
- **Schema & rules:** `schema.json`. `wiki lint` (folded into the audit) keeps it healthy.

## Map
<!-- Link key pages here as they are created, using wikilink syntax like `[[some-entity]]`. -->

## How to use
1. **Ingest** a new/changed source → `wiki ingest <project> --source <path> --type <t>`, then
   synthesize the page (replace the `[[FILL]]` marker, add wikilinks, cite the source).
2. **Query** before deriving → `wiki query <project> <term>`.
3. **Lint** keeps it honest → broken links, missing provenance, and **stale** pages (whose
   cited source changed) block the next gate until fixed.
