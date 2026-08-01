#!/usr/bin/env node
/**
 * `qm` — the deployment CLI entrypoint.
 *
 * This build implements the static, offline gate: `check`. Network-touching and
 * mutating commands (`doctor`, `plan`, `up`, ...) are declared in the README and
 * land on top of this contract core; invoking one here reports that it is not
 * yet implemented rather than pretending to act.
 */

import { runCheck, formatCheck } from "../src/cli/check.mjs";
import { CONTRACT_VERSION } from "../src/contract/index.mjs";

const KNOWN_COMMANDS = [
  "check",
  "doctor",
  "plan",
  "up",
  "status",
  "logs",
  "down",
  "rollback",
  "outputs",
  "conformance",
  "secrets",
  "slack",
  "sandbox",
  "infra",
  "init",
];

/**
 * Parse `--flag` / `--flag=value` / `--flag value` options out of argv.
 * @param {string[]} argv
 * @returns {{ flags: Record<string, string|boolean>, positionals: string[] }}
 */
function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  /** @type {string[]} */
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[body] = argv[++i];
      } else {
        flags[body] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

function main() {
  const [, , command, ...rest] = process.argv;
  const { flags } = parseArgs(rest);

  if (!command || flags.help || command === "help") {
    printUsage();
    process.exit(command ? 0 : 1);
  }
  if (flags.version || command === "--version") {
    process.stdout.write(`contract v${CONTRACT_VERSION}\n`);
    return;
  }

  if (command === "check") {
    if (flags.live) {
      fail("check --live requires a deployed target and is not available in the contract-core build");
    }
    const result = runCheck({
      dir: process.cwd(),
      config: typeof flags.config === "string" ? flags.config : undefined,
      sandboxDir: typeof flags["sandbox-dir"] === "string" ? flags["sandbox-dir"] : undefined,
    });
    if (flags.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write(formatCheck(result) + "\n");
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (KNOWN_COMMANDS.includes(command)) {
    fail(`\`qm ${command}\` is defined by the deployment contract but not implemented in this contract-core build`);
  }

  fail(`unknown command: ${command}`);
}

function printUsage() {
  process.stdout.write(
    [
      "qm — QM deployment CLI (contract-core build)",
      "",
      "Usage: qm <command> [options]",
      "",
      "Implemented:",
      "  check [--json] [--config <path>] [--sandbox-dir <path>]",
      "        Static, offline validation of a deployment directory.",
      "",
      "Declared by the contract (not in this build):",
      "  doctor  plan  up  status  logs  down  rollback  outputs",
      "  conformance  secrets  slack  sandbox  infra  init",
      "",
      "  --version   print the contract version",
      "",
    ].join("\n"),
  );
}

/**
 * @param {string} message
 */
function fail(message) {
  process.stderr.write(`qm: ${message}\n`);
  process.exit(2);
}

main();
