---
name: sync-rules
description: Regenerate the Cursor rule files from the canonical AGENTS.md and rules/common/*.md. Use after editing the harness protocol or any shared rule, so Claude Code and Cursor read the same guidance from one source.
---

# sync-rules

Keeps the portable harness single-sourced. `AGENTS.md` (with `CLAUDE.md` a symlink) is the
truth; this projects it and the `rules/common/*.md` files into `.cursor/rules/*.mdc` for
Cursor.

## Run
```bash
node prd-harness/skills/sync-rules/sync.mjs
```

Idempotent — overwrites the generated `.mdc` files, never edits the source. Run it whenever
`AGENTS.md` or a rule changes; commit the regenerated files alongside the source edit.
