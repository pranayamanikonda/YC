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
