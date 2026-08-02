#!/usr/bin/env node
/**
 * Generate Cursor rules from the one canonical source.
 *
 * The PRD harness keeps a single source of behavioral truth (`AGENTS.md`, with
 * `CLAUDE.md` a symlink to it). Cursor reads `.cursor/rules/*.mdc` instead, so
 * this script projects the canonical protocol and the shared rule files into
 * that format. Run it after editing AGENTS.md or rules/common/*.md:
 *
 *   node prd-harness/skills/sync-rules/sync.mjs
 *
 * Idempotent: it overwrites the generated files and never edits the source.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const harnessRoot = join(here, "..", "..");
const repoRoot = join(harnessRoot, "..");
const cursorRules = join(repoRoot, ".cursor", "rules");
mkdirSync(cursorRules, { recursive: true });

/**
 * @param {string} description Shown to Cursor for rule selection.
 * @param {boolean} always alwaysApply flag.
 * @param {string} body Markdown body.
 * @returns {string}
 */
function mdc(description, always, body) {
  const fm = ["---", `description: ${description}`, `alwaysApply: ${always}`, "---", ""].join("\n");
  return fm + body.replace(/<!-- HARNESS:(BEGIN|END) -->\n?/g, "");
}

// 1. The protocol itself — always applied.
const agents = readFileSync(join(harnessRoot, "AGENTS.md"), "utf8");
writeFileSync(
  join(cursorRules, "prd-harness-protocol.mdc"),
  mdc("PRD Harness agent protocol — how to behave when executing a PRD.", true, agents),
);

// 2. Each shared rule — always applied (they are the always-follow guidelines).
const rulesDir = join(harnessRoot, "rules", "common");
const generated = ["prd-harness-protocol.mdc"];
for (const file of readdirSync(rulesDir).filter((f) => f.endsWith(".md")).sort()) {
  const name = basename(file, ".md");
  const body = readFileSync(join(rulesDir, file), "utf8");
  const out = `prd-harness-${name}.mdc`;
  writeFileSync(join(cursorRules, out), mdc(`PRD Harness rule: ${name}.`, true, body));
  generated.push(out);
}

console.log(`Wrote ${generated.length} Cursor rule files to .cursor/rules/:`);
for (const g of generated) console.log(`  ${g}`);
