/**
 * Deployment-layer (sandbox) descriptor validation.
 *
 * The sandbox adds tools and skills to agent computers. This module validates
 * the *descriptors* — the portable, structural facts — independent of the
 * filesystem. The CLI layers filesystem checks (binary present in the image /
 * installed by the Dockerfile, skill asset files are text) on top of it, and
 * core re-validates the same descriptors on `PUT /v1/deployment-layer`.
 *
 * Only `id` is required on a tool. Every other field buys a specific runtime
 * guarantee and is validated only for shape and safety here.
 */

import { compileApprovals } from "./approvals.mjs";

/** The only interpolation placeholder available in `auth.splitEnv` in v1. */
const V1_SPLIT_ENV_PLACEHOLDERS = new Set(["actingSlackUserId"]);

/** Wildcard egress entries this broad are flagged as dangerous. */
const DANGEROUS_WILDCARDS = new Set([
  "*",
  "*.com",
  "*.net",
  "*.org",
  "*.io",
  "*.dev",
  "*.co",
]);

/**
 * @param {string} id
 * @returns {boolean} Whether `id` is a safe path segment (no slashes/traversal).
 */
function isSafeId(id) {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) &&
    id !== "." &&
    id !== ".."
  );
}

/**
 * Validate a single `$HOME`-relative credential path entry.
 * @param {unknown} entry
 * @param {string} at
 * @param {string[]} errors
 * @param {string[]} warnings
 */
function validateCredentialPath(entry, at, errors, warnings) {
  if (entry === null || typeof entry !== "object") {
    errors.push(`${at} must be an object with { path, kind }`);
    return;
  }
  const { path, kind } = /** @type {any} */ (entry);
  if (typeof path !== "string" || path.length === 0) {
    errors.push(`${at}.path must be a non-empty string`);
  } else {
    if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) {
      errors.push(`${at}.path must be $HOME-relative, not absolute: ${path}`);
    }
    if (path.split(/[\\/]/).includes("..")) {
      errors.push(`${at}.path must not use ".." traversal: ${path}`);
    }
    const first = path.split(/[\\/]/)[0];
    if (first === ".ssh") {
      warnings.push(`${at}.path captures ${path} under ~/.ssh — review carefully`);
    }
  }
  if (kind !== "file" && kind !== "directory") {
    errors.push(`${at}.kind must explicitly be "file" or "directory"`);
  }
}

/**
 * @param {unknown} value
 * @param {string} at
 * @param {string[]} errors
 */
function validateSplitEnv(value, at, errors) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${at} must be an object of NAME -> template`);
    return;
  }
  for (const [name, template] of Object.entries(value)) {
    if (typeof template !== "string") {
      errors.push(`${at}.${name} must be a string template`);
      continue;
    }
    const placeholders = template.match(/\{([^}]*)\}/g) || [];
    for (const raw of placeholders) {
      const key = raw.slice(1, -1);
      if (!V1_SPLIT_ENV_PLACEHOLDERS.has(key)) {
        errors.push(
          `${at}.${name} uses unknown placeholder {${key}}; v1 allows only {actingSlackUserId}`,
        );
      }
    }
  }
}

/**
 * @param {unknown} value
 * @param {string} at
 * @param {string[]} errors
 * @param {string[]} warnings
 */
function validateEgress(value, at, errors, warnings) {
  if (!Array.isArray(value)) {
    errors.push(`${at} must be an array of host names`);
    return;
  }
  value.forEach((host, i) => {
    if (typeof host !== "string" || host.length === 0) {
      errors.push(`${at}[${i}] must be a non-empty host name`);
      return;
    }
    if (DANGEROUS_WILDCARDS.has(host)) {
      warnings.push(`${at}[${i}] "${host}" is a dangerously broad wildcard`);
      return;
    }
    // A host name, optionally a single leading "*." wildcard label.
    const bare = host.startsWith("*.") ? host.slice(2) : host;
    if (host.slice(host.startsWith("*.") ? 2 : 0).includes("*")) {
      errors.push(`${at}[${i}] "${host}" may only wildcard the leading label`);
      return;
    }
    if (!/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(bare)) {
      errors.push(`${at}[${i}] "${host}" is not a valid host name`);
    }
  });
}

/**
 * Validate one tool descriptor's shape and safety.
 * @param {unknown} tool
 * @param {string} [at]
 * @returns {{ id: string | null, errors: string[], warnings: string[] }}
 */
export function validateToolDescriptor(tool, at = "tool") {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];

  if (tool === null || typeof tool !== "object") {
    return { id: null, errors: [`${at} must be an object`], warnings };
  }
  const t = /** @type {any} */ (tool);
  const id = typeof t.id === "string" ? t.id : null;
  if (id === null) {
    errors.push(`${at}.id is required`);
  } else if (!isSafeId(id)) {
    errors.push(`${at}.id "${id}" must be a safe path segment`);
  }

  for (const field of ["label", "install"]) {
    // label optional string; install optional object handled below
    if (field === "label" && t.label !== undefined && typeof t.label !== "string") {
      errors.push(`${at}.label must be a string`);
    }
  }
  if (t.advertise !== undefined && typeof t.advertise !== "boolean") {
    errors.push(`${at}.advertise must be a boolean`);
  }
  if (t.hints !== undefined && !Array.isArray(t.hints)) {
    errors.push(`${at}.hints must be an array of strings`);
  }
  if (t.install !== undefined) {
    if (t.install === null || typeof t.install !== "object") {
      errors.push(`${at}.install must be an object`);
    } else if (t.install.binary !== undefined && typeof t.install.binary !== "string") {
      errors.push(`${at}.install.binary must be a string`);
    }
  }
  if (t.auth !== undefined) {
    if (t.auth === null || typeof t.auth !== "object") {
      errors.push(`${at}.auth must be an object`);
    } else {
      if (t.auth.credentialPaths !== undefined) {
        if (!Array.isArray(t.auth.credentialPaths)) {
          errors.push(`${at}.auth.credentialPaths must be an array`);
        } else {
          t.auth.credentialPaths.forEach((entry, i) =>
            validateCredentialPath(entry, `${at}.auth.credentialPaths[${i}]`, errors, warnings),
          );
        }
      }
      if (t.auth.splitEnv !== undefined) {
        validateSplitEnv(t.auth.splitEnv, `${at}.auth.splitEnv`, errors);
      }
    }
  }
  if (t.egress !== undefined) {
    validateEgress(t.egress, `${at}.egress`, errors, warnings);
  }

  const compiled = compileApprovals(t);
  for (const e of compiled.errors) errors.push(`${at}.${e}`);

  return { id, errors, warnings };
}

/**
 * Validate a skill's parsed frontmatter. Skills require `name` and
 * `description`. Skill assets are text in v1.
 * @param {unknown} skill A `{ id, frontmatter }` shape.
 * @param {string} [at]
 * @returns {{ id: string | null, errors: string[], warnings: string[] }}
 */
export function validateSkill(skill, at = "skill") {
  /** @type {string[]} */
  const errors = [];
  if (skill === null || typeof skill !== "object") {
    return { id: null, errors: [`${at} must be an object`], warnings: [] };
  }
  const s = /** @type {any} */ (skill);
  const id = typeof s.id === "string" ? s.id : null;
  if (id !== null && !isSafeId(id)) {
    errors.push(`${at}.id "${id}" must be a safe path segment`);
  }
  const fm = s.frontmatter;
  if (fm === null || typeof fm !== "object") {
    errors.push(`${at} is missing SKILL.md frontmatter`);
  } else {
    if (typeof fm.name !== "string" || fm.name.length === 0) {
      errors.push(`${at} frontmatter requires a non-empty "name"`);
    }
    if (typeof fm.description !== "string" || fm.description.length === 0) {
      errors.push(`${at} frontmatter requires a non-empty "description"`);
    }
  }
  return { id, errors, warnings: [] };
}

/**
 * Validate a whole parsed sandbox layer: its tool descriptors and skills.
 * Duplicate tool ids fail.
 * @param {{ tools?: unknown[], skills?: unknown[] }} layer
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateSandboxLayer(layer) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];

  const tools = Array.isArray(layer?.tools) ? layer.tools : [];
  const skills = Array.isArray(layer?.skills) ? layer.skills : [];

  const seenTool = new Set();
  tools.forEach((tool, i) => {
    const res = validateToolDescriptor(tool, `tools[${i}]`);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
    if (res.id !== null) {
      if (seenTool.has(res.id)) {
        errors.push(`duplicate tool id "${res.id}"`);
      }
      seenTool.add(res.id);
    }
  });

  const seenSkill = new Set();
  skills.forEach((skill, i) => {
    const res = validateSkill(skill, `skills[${i}]`);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
    if (res.id !== null) {
      if (seenSkill.has(res.id)) {
        errors.push(`duplicate skill id "${res.id}"`);
      }
      seenSkill.add(res.id);
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}
