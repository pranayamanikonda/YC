/**
 * Environment derivation.
 *
 * `publicUrl` is the one public coordinate of a deployment. The CLI derives the
 * core, Slack, web, admin, and portal URL environment from it so operators
 * configure a single address and every surface stays consistent. Config `env`
 * is for non-secret values only and may never carry a URL surface that this
 * derivation owns.
 *
 * The exact variable names are part of this CLI's derivation, not the contract
 * shape: the contract fixes that they are *derived from* `publicUrl`, and this
 * module is their single source of truth.
 */

/** Surfaces derived from `publicUrl`, each a path relative to the base origin. */
const SURFACE_PATHS = Object.freeze({
  QM_CORE_URL: "/",
  QM_WEB_URL: "/",
  QM_ADMIN_URL: "/admin",
  QM_PORTAL_URL: "/portal",
  QM_SLACK_EVENTS_URL: "/slack/events",
  // Must match the redirect an operator registers in the Slack SSO app exactly.
  QM_SLACK_OIDC_REDIRECT_URL: "/auth/callback",
});

/** Env keys this CLI owns; supplying any of them in config `env` is rejected. */
export const DERIVED_ENV_KEYS = Object.freeze([
  "QM_PUBLIC_URL",
  ...Object.keys(SURFACE_PATHS),
]);

/**
 * @param {string} publicUrl
 * @returns {URL} The parsed, normalized base URL (no trailing slash on origin).
 * @throws {Error} If `publicUrl` is not an absolute URL.
 */
export function parsePublicUrl(publicUrl) {
  if (typeof publicUrl !== "string" || publicUrl.length === 0) {
    throw new Error("publicUrl must be a non-empty string");
  }
  let url;
  try {
    url = new URL(publicUrl);
  } catch {
    throw new Error(`publicUrl is not a valid absolute URL: ${publicUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`publicUrl must be http(s): ${publicUrl}`);
  }
  return url;
}

/**
 * @param {string} publicUrl
 * @returns {boolean} Whether `publicUrl` is HTTPS. A real harness requires this.
 */
export function isHttpsPublicUrl(publicUrl) {
  try {
    return parsePublicUrl(publicUrl).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Join the base origin (plus any base path) with a surface path, collapsing
 * duplicate slashes so `/` surfaces return the base itself.
 * @param {URL} base
 * @param {string} surfacePath
 * @returns {string}
 */
function joinSurface(base, surfacePath) {
  const basePath = base.pathname.replace(/\/+$/, "");
  const rel = surfacePath === "/" ? "" : surfacePath;
  const path = `${basePath}${rel}` || "/";
  return `${base.origin}${path}`;
}

/**
 * Derive the full URL environment from `publicUrl`.
 * @param {string} publicUrl
 * @returns {Record<string, string>}
 */
export function deriveEnv(publicUrl) {
  const base = parsePublicUrl(publicUrl);
  const normalizedPublic = joinSurface(base, "/");
  /** @type {Record<string, string>} */
  const env = { QM_PUBLIC_URL: normalizedPublic.replace(/\/$/, "") || normalizedPublic };
  for (const [key, surfacePath] of Object.entries(SURFACE_PATHS)) {
    env[key] = joinSurface(base, surfacePath);
  }
  return env;
}
