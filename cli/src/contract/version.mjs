/**
 * Contract versioning.
 *
 * `contract: 1` in a deployment config is the compatibility *floor* — the
 * oldest directory shape this CLI still interprets. A directory that declares
 * an unknown (higher) major fails closed: this CLI refuses to interpret a shape
 * it does not understand. A CLI may add optional fields within a major; a new
 * incompatible directory shape increments the major.
 */

/** The contract major this CLI implements. */
export const CONTRACT_VERSION = 1;

/**
 * The lowest contract major this CLI can interpret. Equal to
 * {@link CONTRACT_VERSION} until a future CLI drops support for an old major.
 */
export const CONTRACT_FLOOR = 1;

/**
 * @param {unknown} declared The `contract` value read from a config.
 * @returns {{ ok: true } | { ok: false, reason: string }} Whether this CLI can
 *   interpret a directory declaring `declared`.
 */
export function checkContractMajor(declared) {
  if (declared === undefined || declared === null) {
    return { ok: false, reason: "config is missing required `contract`" };
  }
  if (typeof declared !== "number" || !Number.isInteger(declared)) {
    return { ok: false, reason: "`contract` must be an integer major" };
  }
  if (declared < CONTRACT_FLOOR) {
    return {
      ok: false,
      reason: `contract ${declared} is below this CLI's floor ${CONTRACT_FLOOR}`,
    };
  }
  if (declared > CONTRACT_VERSION) {
    // Fail closed on an unknown future major rather than mis-interpret it.
    return {
      ok: false,
      reason: `contract ${declared} is newer than this CLI understands (${CONTRACT_VERSION}); upgrade @yc-software/qm`,
    };
  }
  return { ok: true };
}
