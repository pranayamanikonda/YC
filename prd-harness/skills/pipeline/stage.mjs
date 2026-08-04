/**
 * The generic stage runner for Stages 1–7. One tested core drives every stage
 * declaratively (STAGE_SPEC): it enforces sequencing and gates, scaffolds each
 * stage's artefact homes, checks structural completion, and — when complete —
 * marks the stage done and writes the HANDOFF + ledger entry.
 *
 * Idempotent: the first run scaffolds the artefact stubs (containing a `[[FILL]]`
 * sentinel and, for design artefacts, Rationale + Accessibility sections). The
 * agent fills them; a re-run validates and advances. Creative quality is the
 * human gates' job — the runner enforces structure, sequencing, and hand-off.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGES, gateBefore, nextStage } from "./lib/model.mjs";
import { loadManifest, saveManifest, ledger } from "./lib/project.mjs";
import { computeInputs } from "./audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(here, "..", "..", "templates");

const FILL = "[[FILL]]";

/**
 * Build a design-artefact stub with the mandatory Rationale + Accessibility
 * sections the UX/UI track requires.
 * @param {string} title
 * @param {string} marker A required structural token to keep in the stub.
 * @param {string} intro
 * @returns {string}
 */
function designStub(title, marker, intro) {
  return (
    `# ${title}\n\n> ${intro}\n\n${marker}\n\n${FILL} — replace this stub with real content.\n\n` +
    `## Rationale\n${FILL} — why this, what was rejected.\n\n` +
    `## Accessibility\n${FILL} — WCAG 2.2 AA notes for this artefact.\n`
  );
}

/**
 * @param {string} title
 * @param {string} marker
 * @param {string} intro
 * @returns {string}
 */
function plainStub(title, marker, intro) {
  return `# ${title}\n\n> ${intro}\n\n${marker}\n\n${FILL} — replace this stub with real content.\n`;
}

/**
 * STAGE_SPEC — per-stage artefacts and their completion markers.
 * Each artefact: { path, stub?|from?, marker?, forbid? }.
 *   - `stub`  : content written when the file is missing (carries `[[FILL]]`).
 *   - `from`  : a template file copied+filled when missing (no `[[FILL]]`).
 *   - `marker`: regex the filled file must match (structure present).
 *   - `forbid`: regex the filled file must NOT match (leftover placeholder).
 * A file is complete when it exists, matches `marker`, matches no `forbid`, and
 * contains no `[[FILL]]`.
 */
export const STAGE_SPEC = {
  "1-definition": {
    title: "Definition",
    artefacts: [
      { path: "definition/acceptance-criteria.md", marker: /AC-\d/, forbid: /<observable result>/ },
      { path: "design/principles.md", marker: /DP-1/, stub: designStub("Design Principles", "## DP-1 — <name>", "The principles that guide every design decision. One must name accessibility/inclusion.") },
      { path: "design/scenarios.md", marker: /SC-1/, stub: designStub("Scenarios", "## SC-1 — <name>", "Concrete usage scenarios; at least one keyboard-only / screen-reader.") },
    ],
  },
  "2-ia": {
    title: "Information Architecture",
    artefacts: [
      { path: "design/ia/ia-map.md", marker: /(mermaid|Site map|Nav)/, stub: designStub("Information Architecture", "```mermaid\ngraph TD\n```", "Site/app map, navigation, and taxonomy. Note landmark/heading and focus order.") },
      { path: "design/ia/ecosystem.md", marker: /Actor/, stub: designStub("Ecosystem Map", "## Actors", "Surfaces, actors, data, and trust boundaries.") },
    ],
  },
  "3-workflows": {
    title: "Task Flows",
    artefacts: [
      { path: "design/flows/flows.md", marker: /(mermaid|Flow)/, stub: designStub("Task Flows", "```mermaid\nflowchart TD\n```", "Primary journeys and task flows incl. empty/error/edge states; no colour-only signals.") },
    ],
  },
  "4-wireframes": {
    title: "Wireframes",
    artefacts: [
      { path: "design/wireframes/index.md", marker: /Screen/, stub: designStub("Wireframes", "## Screen 1 — <name>", "Lo-fi, clickable frames mapped to real components. Note reading order, target sizes, labels.") },
    ],
  },
  "5-visual": {
    title: "Visual Design & System",
    artefacts: [
      { path: "design/visual/visual-design.md", marker: /Direction/, stub: designStub("Visual Design", "## Direction", "The chosen visual direction and hi-fi comps. Light+dark parity, contrast, focus, motion-reduce.") },
      { path: "design/design-system/tokens.md", marker: /token/, stub: designStub("Design Tokens", "## Tokens (primitive → semantic → component)", "Color, type, spacing, radius, shadow, motion — light and dark.") },
      { path: "design/design-system/tokens.json", from: "tokens.json", marker: /"\$value"/ },
    ],
  },
  "6-engineering": {
    title: "Engineering",
    artefacts: [
      { path: "docs/plans/active/exec-plan.md", from: "exec-plan.md", marker: /(?=[\s\S]*WU-\d)(?=[\s\S]*testing seam)/i, forbid: /<the outcome/ },
    ],
  },
  "7-ship": {
    title: "Ship & Log",
    artefacts: [
      { path: "docs/validation-report.md", from: "validation-report.md", marker: /READY/, forbid: /READY\*\* \/ \*\*NOT READY/ },
      { path: "CHANGELOG.md", marker: /##/, stub: `# Changelog\n\n## Unreleased\n\n${FILL} — what shipped.\n` },
    ],
  },
};

/**
 * @param {string} name Template file in templates/.
 * @param {Record<string,string>} vars
 * @returns {string}
 */
function fillTemplate(name, vars) {
  let text = readFileSync(join(templatesDir, name), "utf8");
  for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{{${k}}}`, v);
  return text;
}

/**
 * @param {string} projectDir
 * @param {{ path: string, marker?: RegExp, forbid?: RegExp }} art
 * @returns {string[]} issues (empty when complete).
 */
function checkArtefact(projectDir, art) {
  const full = join(projectDir, art.path);
  if (!existsSync(full)) return [`${art.path}: missing`];
  const text = readFileSync(full, "utf8");
  const issues = [];
  if (text.includes(FILL)) issues.push(`${art.path}: still contains ${FILL}`);
  if (art.marker && !art.marker.test(text)) issues.push(`${art.path}: missing required content (${art.marker})`);
  if (art.forbid && art.forbid.test(text)) issues.push(`${art.path}: unresolved placeholder (${art.forbid})`);
  return issues;
}

/**
 * Run one stage: enforce sequencing + gate, scaffold artefacts, validate, and
 * advance (or report what the agent still owes).
 * @param {string} projectDir
 * @param {string} stageId
 * @param {{ date?: string }} [opts]
 * @returns {{ ok: boolean, stage: string, reason?: string, gate?: string, scaffolded?: string[], issues?: string[], next?: string|null }}
 */
export function runStage(projectDir, stageId, opts = {}) {
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const spec = STAGE_SPEC[stageId];
  if (!spec) throw new Error(`unknown or non-runnable stage: ${stageId}`);

  const manifest = loadManifest(projectDir);
  if (!manifest.phaseMask.includes(stageId)) {
    return { ok: false, stage: stageId, reason: `stage not in this project's phase mask` };
  }

  // Sequencing: every earlier masked stage must be done.
  for (const s of STAGES) {
    if (s === stageId) break;
    if (s === "0-intake") continue;
    if (manifest.phaseMask.includes(s) && manifest.stageStatus[s] !== "done") {
      return { ok: false, stage: stageId, reason: `prior stage ${s} is not done` };
    }
  }

  // Gate: a gate before this stage must be human-approved.
  const gate = gateBefore(stageId);
  if (gate && manifest.gates?.[gate] !== "approved") {
    return { ok: false, stage: stageId, gate, reason: `awaiting ${gate} approval` };
  }

  // Scaffold missing artefacts.
  const vars = { title: manifest.title, tier: manifest.tier, date, n: "0001" };
  const scaffolded = [];
  for (const art of spec.artefacts) {
    const full = join(projectDir, art.path);
    if (existsSync(full)) continue;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, art.from ? fillTemplate(art.from, vars) : art.stub);
    scaffolded.push(art.path);
  }

  // Validate completion.
  const issues = spec.artefacts.flatMap((art) => checkArtefact(projectDir, art));
  if (issues.length > 0) {
    manifest.stageStatus[stageId] = "in-progress";
    saveManifest(projectDir, manifest);
    if (scaffolded.length) {
      ledger(projectDir, `stage ${stageId} (${spec.title}) · scaffolded [${scaffolded.join(", ")}]; awaiting content`, date);
    }
    return { ok: false, stage: stageId, scaffolded, issues };
  }

  // Complete: mark done, record input hashes (for staleness detection), hand off.
  manifest.stageStatus[stageId] = "done";
  manifest.stageInputs = manifest.stageInputs || {};
  manifest.stageInputs[stageId] = computeInputs(projectDir, stageId);
  const next = nextStage(manifest.phaseMask, manifest.stageStatus);
  const nextLabel = next ? (gateBefore(next) && manifest.gates[gateBefore(next)] !== "approved" ? gateBefore(next) : next) : "complete";
  saveManifest(projectDir, manifest);
  ledger(
    projectDir,
    `HANDOFF from ${stageId} → ${nextLabel} · status=ready · produced=[${spec.artefacts.map((a) => a.path).join(", ")}]`,
    date,
  );
  return { ok: true, stage: stageId, next };
}
