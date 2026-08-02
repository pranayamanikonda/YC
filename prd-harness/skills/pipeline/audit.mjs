/**
 * Audit & change-propagation.
 *
 * Two jobs:
 *   1. Consistency audit — the whole project is internally coherent (no leftover
 *      `[[FILL]]` in completed stages, indexed assets exist, gate state matches
 *      stage state, acceptance criteria present, engineering has tests).
 *   2. Staleness / change-propagation — when an upstream artefact changes after a
 *      downstream stage was marked done, that stage (and everything downstream of
 *      it) is flagged `stale`. Policy: flag + block ship; never auto-rewrite.
 *
 * Each stage records a hash of its declared inputs on completion (`stageInputs`
 * in the manifest); the audit re-hashes to detect drift.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { STAGES, STAGE_INPUTS, STAGE_ARTEFACTS, gateBefore } from "./lib/model.mjs";
import { loadManifest } from "./lib/project.mjs";

/**
 * @param {string} path
 * @returns {string | null} sha256 hex, or null when the file is absent.
 */
function hashFile(path) {
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Hash a stage's declared inputs that currently exist.
 * @param {string} projectDir
 * @param {string} stageId
 * @returns {Record<string, string>}
 */
export function computeInputs(projectDir, stageId) {
  const inputs = {};
  for (const rel of STAGE_INPUTS[stageId] || []) {
    const h = hashFile(join(projectDir, rel));
    if (h) inputs[rel] = h;
  }
  return inputs;
}

/**
 * Detect stale stages: a done stage whose recorded inputs changed (direct), plus
 * every done stage after it (propagated).
 * @param {string} projectDir
 * @param {any} [manifest]
 * @returns {Array<{ stage: string, reason: string, changedInputs: string[] }>}
 */
export function staleStages(projectDir, manifest = loadManifest(projectDir)) {
  const recorded = manifest.stageInputs || {};
  const out = [];
  let propagate = false;
  for (const stage of STAGES) {
    if (stage === "0-intake" || !manifest.phaseMask.includes(stage)) continue;
    if (manifest.stageStatus[stage] !== "done") continue;
    const changed = [];
    for (const [rel, h] of Object.entries(recorded[stage] || {})) {
      if (hashFile(join(projectDir, rel)) !== h) changed.push(rel);
    }
    const direct = changed.length > 0;
    if (direct || propagate) {
      out.push({ stage, reason: direct ? "input changed" : "upstream stale", changedInputs: changed });
      propagate = true;
    }
  }
  return out;
}

/**
 * Run the consistency + staleness audit.
 * @param {string} projectDir
 * @returns {{ ok: boolean, issues: Array<{ sev: string, msg: string }>, stale: Array<object> }}
 */
export function audit(projectDir) {
  const m = loadManifest(projectDir);
  const issues = [];
  const err = (msg) => issues.push({ sev: "error", msg });
  const warn = (msg) => issues.push({ sev: "warn", msg });

  // 1. No leftover [[FILL]] in a completed stage's artefacts.
  for (const stage of Object.keys(STAGE_ARTEFACTS)) {
    if (m.stageStatus?.[stage] !== "done") continue;
    for (const rel of STAGE_ARTEFACTS[stage]) {
      const full = join(projectDir, rel);
      if (!existsSync(full)) {
        err(`${stage}: artefact missing after completion: ${rel}`);
      } else if (readFileSync(full, "utf8").includes("[[FILL]]")) {
        err(`${stage}: ${rel} still contains [[FILL]] but stage is done`);
      }
    }
  }

  // 2. Indexed assets exist on disk.
  for (const a of m.assets || []) {
    if (!existsSync(join(projectDir, "assets", a.name))) err(`asset indexed but missing: assets/${a.name}`);
  }

  // 3. Gate/stage consistency: a done stage's preceding gate must be approved.
  for (const stage of m.phaseMask || []) {
    if (m.stageStatus?.[stage] !== "done") continue;
    const g = gateBefore(stage);
    if (g && m.gates?.[g] !== "approved") err(`${stage} is done but gate ${g} is not approved`);
  }

  // 4. Traceability (light): acceptance criteria exist; engineering has tests.
  const acPath = join(projectDir, "definition", "acceptance-criteria.md");
  if (m.stageStatus?.["1-definition"] === "done") {
    if (!existsSync(acPath) || !/AC-\d/.test(readFileSync(acPath, "utf8"))) {
      err("definition done but no acceptance criteria (AC-NNN) found");
    }
  }
  if (m.stageStatus?.["6-engineering"] === "done") {
    const testsDir = join(projectDir, "tests");
    const hasTests = existsSync(testsDir) && readdirSync(testsDir).some((f) => /\.(test|spec)\./.test(f));
    if (!hasTests) warn("engineering done but no test files found under tests/");
  }

  // 5. Staleness (change-propagation).
  const stale = staleStages(projectDir, m);
  for (const s of stale) {
    err(`stale: ${s.stage} (${s.reason}${s.changedInputs.length ? ": " + s.changedInputs.join(", ") : ""})`);
  }

  return { ok: !issues.some((i) => i.sev === "error"), issues, stale };
}
