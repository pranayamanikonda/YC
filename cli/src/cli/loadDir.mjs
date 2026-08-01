/**
 * Filesystem loading for a deployment directory. Keeps all IO in the CLI layer;
 * the contract module operates on already-parsed structures.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseConfig } from "../contract/index.mjs";

/**
 * @param {string} dir Deployment directory.
 * @param {string} [configPath] Explicit config path (overrides `dir`).
 * @returns {{ config: unknown, path: string }}
 */
export function loadConfig(dir, configPath) {
  const path = configPath ?? join(dir, "qm.config.jsonc");
  const text = readFileSync(path, "utf8");
  return { config: parseConfig(text), path };
}

/**
 * Parse the leading `--- ... ---` frontmatter block of a SKILL.md into a flat
 * object of top-level `key: value` scalars. Enough for the `name`/`description`
 * the contract requires; deeper YAML is out of scope for validation.
 * @param {string} text
 * @returns {Record<string, string> | null}
 */
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

/**
 * Load a sandbox layer from `<dir>/sandbox` into the shape the contract
 * validator expects. Returns `null` when there is no sandbox directory.
 * @param {string} dir Deployment directory.
 * @param {string} [sandboxDir] Explicit sandbox dir (overrides `dir/sandbox`).
 * @returns {{ tools: unknown[], skills: unknown[], hasDockerfile: boolean } | null}
 */
export function loadSandboxLayer(dir, sandboxDir) {
  const root = sandboxDir ?? join(dir, "sandbox");
  if (!existsSync(root)) return null;

  /** @type {unknown[]} */
  const tools = [];
  const toolsDir = join(root, "tools");
  if (existsSync(toolsDir)) {
    for (const id of listDirs(toolsDir)) {
      const descriptorPath = join(toolsDir, id, "tool.json");
      if (!existsSync(descriptorPath)) {
        tools.push({ id, __error: "missing tool.json" });
        continue;
      }
      try {
        const parsed = JSON.parse(readFileSync(descriptorPath, "utf8"));
        // The directory name is authoritative for the id.
        tools.push({ ...parsed, id: parsed.id ?? id });
      } catch (err) {
        tools.push({ id, __error: `invalid tool.json: ${err.message}` });
      }
    }
  }

  /** @type {unknown[]} */
  const skills = [];
  const skillsDir = join(root, "skills");
  if (existsSync(skillsDir)) {
    for (const id of listDirs(skillsDir)) {
      const skillPath = join(skillsDir, id, "SKILL.md");
      if (!existsSync(skillPath)) {
        skills.push({ id, frontmatter: null });
        continue;
      }
      const frontmatter = parseFrontmatter(readFileSync(skillPath, "utf8"));
      skills.push({ id, frontmatter });
    }
  }

  return {
    tools,
    skills,
    hasDockerfile: existsSync(join(root, "Dockerfile")),
  };
}

/**
 * @param {string} dir
 * @returns {string[]} Immediate subdirectory names, sorted.
 */
function listDirs(dir) {
  return readdirSync(dir)
    .filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}
