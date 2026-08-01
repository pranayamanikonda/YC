/**
 * Deployment config (`qm.config.jsonc`) loading and validation.
 *
 * The root object requires `contract: 1`, `orgId`, `publicUrl`, `target`, and
 * `services` including `core`. Target-specific requirements and the
 * no-secret-values rule are layered on top. Findings are keyed to contract
 * clause ids so `qm check --json` output is stable and machine-readable.
 */

import { parseJsonc } from "./jsonc.mjs";
import { checkContractMajor } from "./version.mjs";
import { DERIVED_ENV_KEYS, isHttpsPublicUrl, parsePublicUrl } from "./env.mjs";
import { isValidFargateSize } from "./fargate.mjs";

/** Recognized deployment targets. */
export const TARGETS = Object.freeze(["docker", "fly", "aws"]);

/** The first-party service that is always required. */
const REQUIRED_SERVICE = "core";

/**
 * Keys whose *name* implies a secret value. Config `env` is for non-secret
 * values only; a secret-shaped key is rejected wherever config env appears.
 */
const SECRET_SHAPED = /(SECRET|TOKEN|PASSWORD|PASSPHRASE|CREDENTIAL|PRIVATE_KEY|API_KEY|ACCESS_KEY)/i;

/**
 * @typedef {object} Finding
 * @property {string} clause Contract clause id (e.g. "config.v1").
 * @property {"error"|"warning"} severity
 * @property {string} path Dotted path into the config, or "" for root.
 * @property {string} message
 */

/**
 * @param {Finding[]} findings
 * @param {string} clause
 * @param {"error"|"warning"} severity
 * @param {string} path
 * @param {string} message
 */
function add(findings, clause, severity, path, message) {
  findings.push({ clause, severity, path, message });
}

/**
 * Parse raw JSONC config text into an object.
 * @param {string} text
 * @returns {unknown}
 */
export function parseConfig(text) {
  return parseJsonc(text);
}

/**
 * Reject secret-shaped keys and CLI-derived keys inside a config `env` map.
 * @param {unknown} env
 * @param {string} path
 * @param {Finding[]} findings
 */
function checkEnvMap(env, path, findings) {
  if (env === undefined) return;
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    add(findings, "config.v1", "error", path, "env must be an object of NAME -> value");
    return;
  }
  for (const key of Object.keys(env)) {
    if (SECRET_SHAPED.test(key)) {
      add(
        findings,
        "config.no-secret-values",
        "error",
        `${path}.${key}`,
        `env key "${key}" is secret-shaped; config env is for non-secret values only`,
      );
    }
    if (DERIVED_ENV_KEYS.includes(key)) {
      add(
        findings,
        "config.no-secret-values",
        "error",
        `${path}.${key}`,
        `env key "${key}" is derived from publicUrl and must not be set in config`,
      );
    }
  }
}

/**
 * @param {string} value
 * @returns {boolean} Whether `value` is a DNS-valid label chain (Cloud Map namespace).
 */
function isDnsName(value) {
  return (
    typeof value === "string" &&
    value.length <= 253 &&
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(value)
  );
}

/**
 * @param {any} config
 * @param {Finding[]} findings
 */
function validateTargetFly(config, findings) {
  if (typeof config.region !== "string" || config.region.length === 0) {
    add(findings, "config.v1", "error", "region", "fly target requires `region`");
  }
  if (typeof config.flyOrg !== "string" || config.flyOrg.length === 0) {
    add(findings, "config.v1", "error", "flyOrg", "fly target requires `flyOrg`");
  }
  requireSandboxApp(config, findings);
}

/**
 * Docker and Fly both require `sandbox.app`.
 * @param {any} config
 * @param {Finding[]} findings
 */
function requireSandboxApp(config, findings) {
  const app = config.sandbox?.app;
  if (typeof app !== "string" || app.length === 0) {
    add(
      findings,
      "config.v1",
      "error",
      "sandbox.app",
      `${config.target} target requires \`sandbox.app\``,
    );
  }
}

/**
 * @param {any} config
 * @param {Finding[]} findings
 */
function validateTargetAws(config, findings) {
  // Sandbox substrate is an explicit choice on AWS.
  if (config.sandbox !== undefined) {
    const backend = config.sandbox.backend;
    if (backend !== "sprites" && backend !== "aws") {
      add(
        findings,
        "config.v1",
        "error",
        "sandbox.backend",
        'declaring `sandbox` on aws requires `sandbox.backend`: "sprites" or "aws"',
      );
    } else if (backend === "sprites") {
      const app = config.sandbox.app;
      if (typeof app !== "string" || app.length === 0) {
        add(
          findings,
          "config.v1",
          "error",
          "sandbox.app",
          'sandbox.backend "sprites" requires the layer image in `sandbox.app`',
        );
      }
    }
  }

  const aws = config.aws;
  if (aws === null || typeof aws !== "object") {
    add(findings, "config.v1", "error", "aws", "aws target requires an `aws` block");
    return;
  }
  if (!/^\d{12}$/.test(String(aws.account ?? ""))) {
    add(findings, "config.v1", "error", "aws.account", "aws.account must be a 12-digit account id");
  }
  for (const field of ["region", "label", "cluster", "deployRoleArn", "secretsPrefix"]) {
    if (typeof aws[field] !== "string" || aws[field].length === 0) {
      add(findings, "config.v1", "error", `aws.${field}`, `aws.${field} is required`);
    }
  }
  if (typeof aws.deployRoleArn === "string" && !/^arn:aws:iam::\d{12}:role\/.+/.test(aws.deployRoleArn)) {
    add(findings, "config.v1", "error", "aws.deployRoleArn", "aws.deployRoleArn is not a valid IAM role ARN");
  }
  if (aws.namespace !== undefined && !isDnsName(aws.namespace)) {
    add(findings, "config.v1", "error", "aws.namespace", "aws.namespace must be a DNS-valid Cloud Map name");
  }

  validateAwsWorkloads(config, findings);
}

/**
 * Every enabled first-party service (and discovered plugin) needs a unique ECR
 * repository, a unique ECS service, and a valid Fargate CPU/memory pair.
 * @param {any} config
 * @param {Finding[]} findings
 */
function validateAwsWorkloads(config, findings) {
  const workloads = config.aws?.workloads;
  if (workloads === undefined) {
    add(findings, "config.v1", "error", "aws.workloads", "aws target requires per-service `aws.workloads`");
    return;
  }
  if (workloads === null || typeof workloads !== "object" || Array.isArray(workloads)) {
    add(findings, "config.v1", "error", "aws.workloads", "aws.workloads must be an object keyed by service/plugin");
    return;
  }

  const services = config.services && typeof config.services === "object" ? config.services : {};
  const enabled = Object.keys(services).filter((k) => services[k] !== false);

  const seenEcr = new Map();
  const seenEcs = new Map();
  for (const name of enabled) {
    const w = workloads[name];
    const at = `aws.workloads.${name}`;
    if (w === null || typeof w !== "object") {
      add(findings, "config.v1", "error", at, `enabled service "${name}" has no aws workload entry`);
      continue;
    }
    for (const [field, seen] of [
      ["ecrRepository", seenEcr],
      ["ecsService", seenEcs],
    ]) {
      const value = w[field];
      if (typeof value !== "string" || value.length === 0) {
        add(findings, "config.v1", "error", `${at}.${field}`, `${at}.${field} is required`);
      } else if (seen.has(value)) {
        add(findings, "config.v1", "error", `${at}.${field}`, `${field} "${value}" is not unique (also ${seen.get(value)})`);
      } else {
        seen.set(value, name);
      }
    }
    if (!isValidFargateSize(w.cpu, w.memory)) {
      add(findings, "aws.rendered-task", "error", `${at}`, `cpu/memory ${w.cpu}/${w.memory} is not a valid Fargate size`);
    }
    if (w.image !== undefined && w.architecture === undefined) {
      add(findings, "config.v1", "error", `${at}.architecture`, "external prebuilt images must declare `architecture`");
    }
    if (w.architecture !== undefined && w.architecture !== "arm64" && w.architecture !== "amd64") {
      add(findings, "config.v1", "error", `${at}.architecture`, 'architecture must be "arm64" or "amd64"');
    }
  }
}

/**
 * @param {any} config
 * @param {Finding[]} findings
 */
function validateSecurityScreen(config, findings) {
  const screen = config.securityScreen;
  if (screen === undefined) return; // absence keeps Auto on the built-in classifier
  if (screen === null || typeof screen !== "object") {
    add(findings, "config.v1", "error", "securityScreen", "securityScreen must be an object");
    return;
  }
  if (screen.backend !== "proxy") {
    add(findings, "config.v1", "error", "securityScreen.backend", 'securityScreen.backend must be "proxy"');
  }
  if (typeof screen.provider !== "string" || screen.provider !== screen.provider?.toLowerCase?.()) {
    add(findings, "config.v1", "error", "securityScreen.provider", "securityScreen.provider must be a lowercase label");
  }
  if (typeof screen.endpoint !== "string" || !/^https:\/\//.test(screen.endpoint)) {
    add(findings, "config.v1", "error", "securityScreen.endpoint", "securityScreen.endpoint must be an HTTPS URL");
  }
  if (screen.rollout !== "shadow" && screen.rollout !== "enforce") {
    add(findings, "config.v1", "error", "securityScreen.rollout", 'securityScreen.rollout must be "shadow" or "enforce"');
  }
  const token = config.secretEnv?.core?.SECURITY_SCREEN_PROXY_TOKEN;
  if (typeof token !== "string" || token.length === 0) {
    add(
      findings,
      "secrets.computed-set",
      "error",
      "secretEnv.core.SECURITY_SCREEN_PROXY_TOKEN",
      "securityScreen requires secretEnv.core.SECURITY_SCREEN_PROXY_TOKEN",
    );
  }
}

/**
 * Validate a parsed deployment config.
 * @param {unknown} config
 * @returns {{ ok: boolean, findings: Finding[] }}
 */
export function validateConfig(config) {
  /** @type {Finding[]} */
  const findings = [];

  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    add(findings, "config.v1", "error", "", "config must be a JSON object");
    return { ok: false, findings };
  }
  const c = /** @type {any} */ (config);

  const major = checkContractMajor(c.contract);
  if (!major.ok) {
    add(findings, "config.v1", "error", "contract", major.reason);
  }

  if (typeof c.orgId !== "string" || c.orgId.length === 0) {
    add(findings, "config.v1", "error", "orgId", "orgId is required");
  }

  if (typeof c.publicUrl !== "string" || c.publicUrl.length === 0) {
    add(findings, "config.v1", "error", "publicUrl", "publicUrl is required");
  } else {
    try {
      parsePublicUrl(c.publicUrl);
      if (!isHttpsPublicUrl(c.publicUrl)) {
        const severity = c.target === "docker" ? "warning" : "error";
        add(findings, "config.v1", severity, "publicUrl", "a real harness requires an HTTPS publicUrl");
      }
    } catch (err) {
      add(findings, "config.v1", "error", "publicUrl", err.message);
    }
  }

  if (!TARGETS.includes(c.target)) {
    add(findings, "config.v1", "error", "target", `target must be one of ${TARGETS.join(", ")}`);
  }

  if (c.services === null || typeof c.services !== "object" || Array.isArray(c.services)) {
    add(findings, "config.v1", "error", "services", "services is required and must be an object");
  } else if (c.services[REQUIRED_SERVICE] === undefined) {
    add(findings, "config.v1", "error", "services.core", "services must include `core`");
  }

  // No-secret-values applies to root env and per-service env.
  checkEnvMap(c.env, "env", findings);
  if (c.serviceEnv && typeof c.serviceEnv === "object") {
    for (const [svc, env] of Object.entries(c.serviceEnv)) {
      checkEnvMap(env, `serviceEnv.${svc}`, findings);
    }
  }

  // Target-specific requirements.
  if (c.target === "docker") {
    requireSandboxApp(c, findings);
  } else if (c.target === "fly") {
    validateTargetFly(c, findings);
  } else if (c.target === "aws") {
    validateTargetAws(c, findings);
  }

  validateSecurityScreen(c, findings);

  const ok = !findings.some((f) => f.severity === "error");
  return { ok, findings };
}
