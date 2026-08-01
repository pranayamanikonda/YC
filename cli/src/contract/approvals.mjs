/**
 * Approval-rule compilation.
 *
 * A tool descriptor's `approvals` are appended to the command-policy floor. The
 * governing constraint is directional: a rule may only *tighten* — deny or
 * require approval for the tool's own commands. It may never add an allow or
 * loosen administrator policy.
 *
 * Two rule shapes are accepted:
 *   - `{ action, command }`  — the CLI anchors it to the tool's effective binary.
 *   - `{ action, pattern }`  — a raw regex that must already begin with the
 *                              canonical `\b<binary>\b` boundary and must not
 *                              use a top-level alternative, so every match
 *                              begins with the tool's own binary. Nested
 *                              alternatives after that prefix remain available.
 *
 * `action` is `"deny"` or `"ask"`. `"allow"` (or anything else) is rejected.
 */

/** Allowed tightening actions. `allow` is deliberately absent. */
const ALLOWED_ACTIONS = new Set(["deny", "ask"]);

/**
 * @param {{ id?: unknown, install?: { binary?: unknown } }} tool
 * @returns {string} The effective binary a tool's rules anchor to: its declared
 *   `install.binary`, else its `id`.
 */
export function effectiveBinary(tool) {
  const binary = tool?.install?.binary;
  if (typeof binary === "string" && binary.length > 0) return binary;
  return typeof tool?.id === "string" ? tool.id : "";
}

/**
 * @param {string} literal
 * @returns {string} `literal` with all regex metacharacters escaped.
 */
function escapeRegex(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Detect a top-level `|` — one that sits outside any group `( )` and any
 * character class `[ ]`. Such an alternative could let a match begin with
 * something other than the tool's own binary, so it is rejected.
 * @param {string} pattern
 * @returns {boolean}
 */
function hasTopLevelAlternation(pattern) {
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      i++; // skip the escaped character
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "|" && depth === 0) return true;
  }
  return false;
}

/**
 * Compile one tool's approval rules.
 * @param {{ id?: unknown, install?: { binary?: unknown }, approvals?: unknown }} tool
 * @returns {{ rules: Array<{ action: string, source: string }>, errors: string[] }}
 */
export function compileApprovals(tool) {
  /** @type {Array<{ action: string, source: string }>} */
  const rules = [];
  /** @type {string[]} */
  const errors = [];

  const approvals = tool?.approvals;
  if (approvals === undefined) return { rules, errors };
  if (!Array.isArray(approvals)) {
    errors.push("approvals must be an array");
    return { rules, errors };
  }

  const binary = effectiveBinary(tool);
  if (binary.length === 0) {
    errors.push("cannot compile approvals: tool has no id or install.binary");
    return { rules, errors };
  }
  const boundary = `\\b${escapeRegex(binary)}\\b`;

  approvals.forEach((rule, index) => {
    const at = `approvals[${index}]`;
    if (rule === null || typeof rule !== "object") {
      errors.push(`${at} must be an object`);
      return;
    }
    const action = /** @type {any} */ (rule).action;
    if (!ALLOWED_ACTIONS.has(action)) {
      errors.push(
        `${at}.action must be "deny" or "ask" (an approval rule may only tighten, never allow)`,
      );
      return;
    }

    const hasCommand = typeof (/** @type {any} */ (rule).command) === "string";
    const hasPattern = typeof (/** @type {any} */ (rule).pattern) === "string";
    if (hasCommand === hasPattern) {
      errors.push(`${at} must set exactly one of "command" or "pattern"`);
      return;
    }

    if (hasCommand) {
      const command = /** @type {any} */ (rule).command.trim();
      if (command.length === 0) {
        errors.push(`${at}.command must be non-empty`);
        return;
      }
      // Anchor to the effective binary, then the escaped command tokens.
      const tokens = command.split(/\s+/).map(escapeRegex);
      rules.push({ action, source: `${boundary}\\s+${tokens.join("\\s+")}` });
      return;
    }

    const pattern = /** @type {any} */ (rule).pattern;
    if (!pattern.startsWith(boundary)) {
      errors.push(
        `${at}.pattern must start with the canonical boundary ${boundary}`,
      );
      return;
    }
    if (hasTopLevelAlternation(pattern)) {
      errors.push(
        `${at}.pattern must not use a top-level alternative; every match must begin with ${boundary}`,
      );
      return;
    }
    try {
      new RegExp(pattern);
    } catch (err) {
      errors.push(`${at}.pattern is not a valid regex: ${err.message}`);
      return;
    }
    rules.push({ action, source: pattern });
  });

  return { rules, errors };
}
