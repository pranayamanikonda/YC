/**
 * `qm check` — static validation of a deployment directory. No network access.
 * Validates the config, the no-secret-values rule, and (when `sandbox/` exists)
 * the layer descriptors and skills. Output is JSON keyed to clause ids, or a
 * human-readable summary.
 */

import { validateConfig, validateSandboxLayer } from "../contract/index.mjs";
import { loadConfig, loadSandboxLayer } from "./loadDir.mjs";

/**
 * Run the static check and return a structured result.
 * @param {{ dir?: string, config?: string, sandboxDir?: string }} opts
 * @returns {{ ok: boolean, clauses: Record<string, { status: string, findings: any[] }>, findings: any[] }}
 */
export function runCheck(opts = {}) {
  const dir = opts.dir ?? process.cwd();
  /** @type {any[]} */
  const findings = [];

  let config;
  try {
    ({ config } = loadConfig(dir, opts.config));
  } catch (err) {
    findings.push({ clause: "config.v1", severity: "error", path: "", message: `cannot load config: ${err.message}` });
    return finalize(findings);
  }

  const configResult = validateConfig(config);
  findings.push(...configResult.findings);

  const layer = loadSandboxLayer(dir, opts.sandboxDir);
  if (layer) {
    // Surface any IO/parse errors captured during loading.
    for (const tool of layer.tools) {
      if (tool && typeof tool === "object" && "__error" in tool) {
        findings.push({
          clause: "sandbox.descriptors",
          severity: "error",
          path: `sandbox/tools/${/** @type {any} */ (tool).id}`,
          message: /** @type {any} */ (tool).__error,
        });
      }
    }
    const layerResult = validateSandboxLayer(layer);
    for (const e of layerResult.errors) {
      findings.push({ clause: "sandbox.descriptors", severity: "error", path: "sandbox", message: e });
    }
    for (const w of layerResult.warnings) {
      findings.push({ clause: "sandbox.descriptors", severity: "warning", path: "sandbox", message: w });
    }
  }

  return finalize(findings);
}

/**
 * @param {any[]} findings
 */
function finalize(findings) {
  /** @type {Record<string, { status: string, findings: any[] }>} */
  const clauses = {};
  for (const f of findings) {
    const entry = (clauses[f.clause] ??= { status: "pass", findings: [] });
    entry.findings.push(f);
    if (f.severity === "error") entry.status = "fail";
    else if (f.severity === "warning" && entry.status === "pass") entry.status = "warn";
  }
  const ok = !findings.some((f) => f.severity === "error");
  return { ok, clauses, findings };
}

/**
 * Render a human-readable summary of a check result.
 * @param {ReturnType<typeof runCheck>} result
 * @returns {string}
 */
export function formatCheck(result) {
  const lines = [];
  const clauseIds = Object.keys(result.clauses).sort();
  if (clauseIds.length === 0) {
    lines.push("✓ check passed — no findings");
  }
  for (const id of clauseIds) {
    const c = result.clauses[id];
    const mark = c.status === "fail" ? "✗" : c.status === "warn" ? "!" : "✓";
    lines.push(`${mark} ${id}`);
    for (const f of c.findings) {
      const where = f.path ? ` (${f.path})` : "";
      lines.push(`    ${f.severity}: ${f.message}${where}`);
    }
  }
  lines.push("");
  lines.push(result.ok ? "check: PASS" : "check: FAIL");
  return lines.join("\n");
}
