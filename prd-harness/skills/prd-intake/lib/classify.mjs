/**
 * Size classifier (Stage 0). Scores a PRD on three axes and takes the highest
 * tier reached on any axis, then maps the tier to a phase mask — the set of
 * stages the pipeline runs. Security / public-API work is floored at `standard`.
 *
 * See process.md § "Size classifier → phase mask".
 */

/** Stage ids in pipeline order. */
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

/** Tier -> the stages that run for it. */
export const PHASE_MASKS = Object.freeze({
  trivial: ["1-definition", "6-engineering", "7-ship"],
  small: ["1-definition", "4-wireframes", "6-engineering", "7-ship"],
  standard: ["1-definition", "2-ia", "3-workflows", "4-wireframes", "6-engineering", "7-ship"],
  large: [...STAGES],
});

const TIER_ORDER = ["trivial", "small", "standard", "large"];

/**
 * @param {number} score 0..3+
 * @returns {string} tier name for a single axis.
 */
function axisTier(score) {
  if (score <= 0) return "trivial";
  if (score === 1) return "small";
  if (score === 2) return "standard";
  return "large";
}

/**
 * @param {string} text Raw PRD text.
 * @returns {number} count of matches for a set of alternation keywords.
 */
function countMatches(text, re) {
  return (text.match(re) || []).length;
}

/**
 * Classify a PRD.
 * @param {string} text Raw PRD markdown.
 * @param {{ tierHint?: string }} [opts] Explicit tier override from frontmatter.
 * @returns {{ tier: string, mask: string[], signals: Record<string, number>, forced: boolean }}
 */
export function classify(text, opts = {}) {
  const lower = String(text).toLowerCase();

  // surface: distinct product areas / screens / services touched.
  const surface = countMatches(lower, /\b(screen|page|view|service|surface|endpoint|dashboard)\b/g);
  // contract-novelty: new external contracts, data models, dependencies.
  const contract = countMatches(lower, /\b(api|schema|data model|integration|dependency|contract|migration)\b/g);
  // ambiguity: unstated bits that need confirmation.
  const ambiguity = countMatches(lower, /\b(assum|tbd|unclear|maybe|to be decided)\b/g) + countMatches(text, /\?/g);

  const signals = {
    surface,
    contract,
    ambiguity,
    surfaceTier: TIER_ORDER.indexOf(axisTier(Math.min(3, Math.floor(surface / 2)))),
    contractTier: TIER_ORDER.indexOf(axisTier(Math.min(3, contract))),
    ambiguityTier: TIER_ORDER.indexOf(axisTier(Math.min(3, Math.floor(ambiguity / 2)))),
  };

  let tierIdx = Math.max(signals.surfaceTier, signals.contractTier, signals.ambiguityTier, 0);

  // Explicit hint from PRD frontmatter wins if it is higher (never lets a PRD
  // downgrade itself below what the content implies).
  if (opts.tierHint && TIER_ORDER.includes(opts.tierHint)) {
    tierIdx = Math.max(tierIdx, TIER_ORDER.indexOf(opts.tierHint));
  }

  // Security / public-API work is floored at standard.
  const forced = /\b(security|auth|public api|pii|payment|credential|compliance)\b/.test(lower);
  if (forced) tierIdx = Math.max(tierIdx, TIER_ORDER.indexOf("standard"));

  const tier = TIER_ORDER[tierIdx];
  return { tier, mask: PHASE_MASKS[tier], signals, forced };
}
