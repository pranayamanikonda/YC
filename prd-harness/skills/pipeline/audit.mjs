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
 * Recursively list `.md` files under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/**
 * Heuristic design-system lint. Not a full token engine — it enforces the basics
 * the doc OS asks for: tokens exist once visual is done, colors come from tokens
 * (not raw hex), and component states + responsive behaviour are documented.
 * @param {string} projectDir
 * @param {any} manifest
 * @returns {Array<{ sev: string, msg: string }>}
 */
export function designLint(projectDir, manifest) {
  const issues = [];
  const rel = (p) => p.slice(projectDir.length + 1);
  const visualDone = manifest.stageStatus?.["5-visual"] === "done";
  const tokensPath = join(projectDir, "design", "design-system", "tokens.md");

  // Tokens must define the core groups once the visual stage is done.
  if (visualDone) {
    if (!existsSync(tokensPath)) {
      issues.push({ sev: "error", msg: "design-lint: visual done but design-system/tokens.md is missing" });
    } else {
      const t = readFileSync(tokensPath, "utf8");
      for (const [group, re] of [
        ["color", /colou?r|palette|#[0-9a-f]{3,6}/i],
        ["type", /font|typograph|type scale/i],
        ["spacing", /spac|gap|margin|padding/i],
      ]) {
        if (!re.test(t)) issues.push({ sev: "error", msg: `design-lint: tokens.md defines no ${group} tokens` });
      }
    }
  }

  // Colors should come from tokens, not raw hex in other design docs.
  for (const file of listMarkdown(join(projectDir, "design"))) {
    if (file === tokensPath) continue;
    const text = readFileSync(file, "utf8");
    if (text.includes("[[FILL]]")) continue; // stub, not yet authored
    if (/#[0-9a-fA-F]{6}\b/.test(text)) {
      issues.push({ sev: "warn", msg: `design-lint: raw color in ${rel(file)} — define it as a token instead` });
    }
  }

  // Component states + responsive behaviour must be documented once designed.
  const designText = [join(projectDir, "design", "wireframes", "index.md"), join(projectDir, "design", "visual", "visual-design.md")]
    .filter((p) => existsSync(p) && !readFileSync(p, "utf8").includes("[[FILL]]"))
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
  if (designText) {
    if (!/(hover|focus|disabled|error state|empty state|loading|active state)/i.test(designText)) {
      issues.push({ sev: "warn", msg: "design-lint: no component states (hover/focus/disabled/error/empty/loading) documented" });
    }
    if (!/(responsive|breakpoint|mobile|viewport|small screen)/i.test(designText)) {
      issues.push({ sev: "warn", msg: "design-lint: responsive behaviour not documented" });
    }
  }

  return issues;
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

  // 5. Design-lint (heuristic proof of the design system).
  for (const iss of designLint(projectDir, m)) issues.push(iss);

  // 6. Staleness (change-propagation).
  const stale = staleStages(projectDir, m);
  for (const s of stale) {
    err(`stale: ${s.stage} (${s.reason}${s.changedInputs.length ? ": " + s.changedInputs.join(", ") : ""})`);
  }

  return { ok: !issues.some((i) => i.sev === "error"), issues, stale };
}
