# QM

The `qm` deployment CLI and the portable deployment-directory contract.

- **[`docs/deploy-directory.md`](docs/deploy-directory.md)** — the normative contract
  v1: directory shape, configuration, security-screen proxy, secrets, tool descriptors,
  delivery/pins, targets, and clause status.
- **[`cli/`](cli/)** — the `@yc-software/qm` package. This checkout implements the
  semver-stable `@yc-software/qm/contract` export and the static, offline `qm check`
  gate. See [`cli/README.md`](cli/README.md).

## Quick start

```bash
cd cli
npm test              # node --test, no dependencies
node bin/qm.mjs --help
```

Validate a deployment directory:

```bash
cd path/to/deployment   # contains qm.config.jsonc
node /path/to/cli/bin/qm.mjs check --json
```

## Layout

```text
docs/deploy-directory.md   normative contract v1
cli/
  bin/qm.mjs               CLI entrypoint (check implemented)
  src/contract/            @yc-software/qm/contract — the stable surface
  src/cli/                 filesystem loading + check command
  test/                    node:test suite (58 tests)
```

## Status

The contract core is implemented and tested: contract versioning with fail-closed
behavior on unknown majors, config loading and validation keyed to clause ids,
environment derivation from `publicUrl`, approval-rule compilation, sandbox-layer
descriptor and skill validation, the Fargate size table, and provider ids. Network and
mutating commands (`doctor`, `plan`, `up`, and the per-target backends) are declared by
the contract and land on top of this core; invoking one today reports that it is not yet
implemented rather than acting.
