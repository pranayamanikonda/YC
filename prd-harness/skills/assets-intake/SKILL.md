---
name: assets-intake
description: Bring uploaded or attached files (logos, brand assets, reference PDFs, images) into a project so they are tracked and durable. Copies them into <project>/assets/, content-hashes them, records them in the manifest, and de-duplicates. Use whenever the human provides an asset file to a project.
---

# assets-intake

Files a human attaches land in the session upload area, which is **ephemeral** — nothing
there survives the session. This skill copies them into the project's `assets/` folder so
they are committed and durable, and records their provenance.

## Run
```bash
node prd-harness/skills/assets-intake/ingest.mjs <projectDir> <file...>
```

Example — ingest an uploaded logo:
```bash
node prd-harness/skills/assets-intake/ingest.mjs ./out/my-project \
  /root/.claude/uploads/<session>/<hash>-logo.svg
```

## What it does
- Copies each file into `<project>/assets/` (safe filename; hash-suffixed on name collision).
- Records `{ name, sha256, bytes, source, ingestedAt }` in `.harness/manifest.json` → `assets[]`.
- Appends a ledger entry.
- **Idempotent**: identical content (same sha256) is skipped, never duplicated.

## Guidance
- Text/small binaries: keep in `assets/` (committed → durable).
- Large binaries: prefer a link (Figma/Drive) recorded in `design/figma-links.md`; git is a
  poor store for big blobs. See `STORAGE.md`.
- The uploaded original is not the source of truth once ingested — the copy in `assets/` is.
