/**
 * Built-in target provider ids. The contract export publishes the *ids* so
 * conformance tests can assert the provider set without registering arbitrary
 * runtime plugins. Loading arbitrary provider packages at runtime is outside
 * contract v1.
 */

/** @type {ReadonlyArray<string>} */
export const PROVIDER_IDS = Object.freeze(["docker", "fly", "aws"]);

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export function isKnownProvider(id) {
  return typeof id === "string" && PROVIDER_IDS.includes(id);
}
