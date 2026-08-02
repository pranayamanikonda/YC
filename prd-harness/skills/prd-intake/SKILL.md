---
name: prd-intake
description: Stage 0 of the PRD harness. Use when a PRD is given and no project exists yet. Normalizes the PRD, classifies its size into a phase mask, scaffolds the per-project folder structure with populated templates and a seed backlog.xlsx, and opens the ledger with a HANDOFF to G1. Run before any other stage.
---

# prd-intake (Stage 0 · Intake & Framing)

The entry point. Turns a raw PRD into a structured, classified project and stops at the
first human gate.

## When to use
A PRD (or a rough product idea) is provided and there is no `<project>/` yet. Always the
first stage; every other stage reads what this one writes.

## What it does
1. Normalizes the PRD into `prd/PRD.md` (the source of truth) with tier/date frontmatter.
2. Classifies size → phase mask (`lib/classify.mjs`): `trivial | small | standard | large`;
   security/public-API forces ≥ standard.
3. Creates the project tree (`process.md` layout) and fills templates: product brief,
   epics, acceptance-criteria, ADR-0001, `design/figma-links.md`.
4. Generates a real `definition/backlog.xlsx` (Epics · Stories · AcceptanceCriteria) via the
   dependency-free writer in `lib/xlsx.mjs`.
5. Writes `.harness/manifest.json` (tier, mask, capability profile, stage status) and opens
   `.harness/ledger/<slug>.md` with a **HANDOFF → G1**.

## Run
```bash
node prd-harness/skills/prd-intake/scaffold.mjs <path/to/PRD.md> [outDir]
```
Or import `scaffold({ prdText, outDir, date, capabilities })` from `scaffold.mjs`.

## After it runs
Present the framing to the human: tier + phase mask, the assumptions-to-confirm list, and
non-goals. **Stop at G1.** Do not proceed to Stage 1 (Definition) until the human approves.
The lead agent for framing judgment is `product-analyst`; the scaffolder is its tool.
