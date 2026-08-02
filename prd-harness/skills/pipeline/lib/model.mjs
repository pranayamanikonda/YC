/**
 * Pipeline model: the stage order, the gates, and pure helpers for advancing.
 * No IO. See ../../../process.md for the authoritative graph.
 */

/** Stage ids in pipeline order (Stage 0 is run by prd-intake). */
export const STAGES = Object.freeze([
  "0-intake",
  "1-definition",
  "2-ia",
  "3-workflows",
  "4-wireframes",
  "5-visual",
  "6-engineering",
  "7-ship",
]);

/** All gate ids. */
export const GATES = Object.freeze(["G1", "G2", "G3"]);

/**
 * Who owns each stage's decisions: `Agent` (autonomous), `Shared` (agent produces,
 * human reviews/approves), or `User` (needs human judgment). Gates are the
 * `Automated gate` (audit) + `User` (approval) checkpoints between stages.
 */
export const OWNERSHIP = Object.freeze({
  "0-intake": "Agent",
  "1-definition": "Shared",
  "2-ia": "Agent",
  "3-workflows": "Agent",
  "4-wireframes": "Shared",
  "5-visual": "Shared",
  "6-engineering": "Agent",
  "7-ship": "Shared",
});

/**
 * A gate that must be human-approved *before* entering the keyed stage.
 * G1 before Definition, G2 before Engineering, G3 before Ship — robust to any
 * phase mask, since the gate binds to the stage transition, not a fixed index.
 */
export const GATE_BEFORE = Object.freeze({
  "1-definition": "G1",
  "6-engineering": "G2",
  "7-ship": "G3",
});

/**
 * Upstream artefacts each stage reads. When a stage completes, the runner hashes
 * these; the audit re-hashes them to detect a mid-pipeline change (staleness).
 */
export const STAGE_INPUTS = Object.freeze({
  "1-definition": ["prd/PRD.md"],
  "2-ia": ["prd/PRD.md", "definition/acceptance-criteria.md"],
  "3-workflows": ["definition/acceptance-criteria.md", "design/ia/ia-map.md", "design/scenarios.md"],
  "4-wireframes": ["design/ia/ia-map.md", "design/flows/flows.md"],
  "5-visual": ["design/wireframes/index.md", "design/principles.md"],
  "6-engineering": ["definition/acceptance-criteria.md", "design/wireframes/index.md", "design/visual/visual-design.md"],
  "7-ship": ["docs/plans/active/exec-plan.md"],
});

/**
 * The artefacts each stage produces (paths only). The audit scans these for
 * leftover `[[FILL]]` in stages marked done. STAGE_SPEC in stage.mjs is the
 * authoritative detail; a test asserts these path sets agree.
 */
export const STAGE_ARTEFACTS = Object.freeze({
  "1-definition": ["definition/acceptance-criteria.md", "design/principles.md", "design/scenarios.md"],
  "2-ia": ["design/ia/ia-map.md", "design/ia/ecosystem.md"],
  "3-workflows": ["design/flows/flows.md"],
  "4-wireframes": ["design/wireframes/index.md"],
  "5-visual": ["design/visual/visual-design.md", "design/design-system/tokens.md"],
  "6-engineering": ["docs/plans/active/exec-plan.md"],
  "7-ship": ["docs/validation-report.md", "CHANGELOG.md"],
});

/**
 * The next stage to run: the first stage that is in the mask and not yet done.
 * @param {string[]} mask Stages this project runs.
 * @param {Record<string, string>} stageStatus id -> "done" | other.
 * @returns {string | null} next stage id, or null when the mask is complete.
 */
export function nextStage(mask, stageStatus) {
  const inMask = new Set(mask);
  for (const stage of STAGES) {
    if (stage === "0-intake") continue; // intake is a precondition, not run here
    if (!inMask.has(stage)) continue;
    if (stageStatus[stage] !== "done") return stage;
  }
  return null;
}

/**
 * The gate blocking entry to a stage, if any.
 * @param {string} stage
 * @returns {string | null}
 */
export function gateBefore(stage) {
  return GATE_BEFORE[stage] || null;
}
