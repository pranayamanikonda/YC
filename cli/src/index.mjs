/**
 * `@yc-software/qm` package root. The stable, conformance-facing surface lives
 * at `@yc-software/qm/contract`; this root re-exports it plus the CLI's static
 * check entrypoints for programmatic use.
 */

export * from "./contract/index.mjs";
export { runCheck, formatCheck } from "./cli/check.mjs";
