#!/usr/bin/env bash
# SessionStart bootstrap for the PRD harness. Points the agent at the canonical
# protocol so the pipeline is loaded before any PRD work begins. Prints to stdout;
# the harness surfaces it as context. Never fails the session (exit 0).
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
cat <<MSG
[prd-harness] Active. Before acting on a PRD:
  1. Read ${root}/AGENTS.md (the agent protocol) and ${root}/process.md (the pipeline).
  2. If a PRD is given and no <project>/ exists, run Stage 0:
       node ${root}/skills/prd-intake/scaffold.mjs <PRD.md> [outDir]
     then STOP at G1 (present tier, phase mask, assumptions-to-confirm, non-goals).
  3. Respect gates G1/G2/G3. Author != reviewer. No completion claim without fresh evidence.
MSG
exit 0
