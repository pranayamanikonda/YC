# AGENTS.md

This repository is a zero-dependency Node.js workspace with two parts:

- `cli/` — the `@yc-software/qm` deployment CLI (see [`cli/README.md`](cli/README.md) and
  [`docs/deploy-directory.md`](docs/deploy-directory.md)).
- `prd-harness/` — the PRD → delivery harness: agent protocol, skills, and docs. See
  [`prd-harness/AGENTS.md`](prd-harness/AGENTS.md), which is the authoritative agent protocol
  and takes precedence for PRD work.

## Cursor Cloud specific instructions

- Runtime: Node.js `>=22` (see `cli/package.json` `engines`). The VM has a compatible Node
  preinstalled; there is nothing to compile.
- Dependencies: there are none. Both `package.json` (root) and `cli/package.json` declare
  empty `dependencies`/`devDependencies`, and there is no lockfile. The startup update
  script (`npm install`) is effectively a no-op today and only future-proofs added deps —
  you do not need to install anything to test or run.
- Tests: `npm test` from the repo root runs `node --test`, which discovers every suite
  (`cli/test/**` plus `prd-harness/**/test`). `cd cli && npm test` runs only the CLI suite.
  No test framework beyond the Node built-in test runner.
- Lint: there is no linter/formatter configured (no ESLint/Prettier, no `lint` script).
  "Run lint" is not applicable here.
- Running the app: `node cli/bin/qm.mjs <command>`. This build implements only `check`
  (static, offline validation of a deployment directory) and `--version`. All other
  contract commands (`doctor`, `plan`, `up`, `init`, `infra`, etc.) intentionally print a
  "not implemented" message and exit non-zero rather than acting — this is expected, not a
  bug. `qm check` requires a deployment directory containing `qm.config.jsonc`; run it from
  inside that directory or pass `--config <path>`. It exits `0` on a valid directory and `1`
  with clause-keyed findings on a violation.
- `prd-harness/` is documentation + skills, not a long-running service; there is no server
  to start. Its executable skills are plain Node scripts (e.g.
  `node prd-harness/skills/prd-intake/scaffold.mjs`). Do not run
  `prd-harness/skills/sync-rules/sync.mjs` unless you intend to regenerate `.cursor/rules/*`.
