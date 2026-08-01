/**
 * Minimal JSONC parser: standard JSON plus `//` line comments, `/* *\/` block
 * comments, and a tolerated trailing comma before `}` or `]`. Kept dependency
 * free because the package declares no runtime dependencies.
 *
 * Comments and trailing commas are stripped from outside string literals, then
 * the residue is handed to `JSON.parse` so numbers, escapes, and structure keep
 * exact JSON semantics.
 */

/**
 * @param {string} text Raw `qm.config.jsonc` contents.
 * @returns {unknown} The parsed value.
 * @throws {SyntaxError} If the residual JSON does not parse.
 */
export function parseJsonc(text) {
  const stripped = stripCommentsAndTrailingCommas(text);
  return JSON.parse(stripped);
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripCommentsAndTrailingCommas(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : "";

    if (lineComment) {
      if (ch === "\n") {
        lineComment = false;
        out += ch;
      }
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    out += ch;
  }

  // Drop a trailing comma that directly precedes a closing brace/bracket.
  return out.replace(/,(\s*[}\]])/g, "$1");
}
