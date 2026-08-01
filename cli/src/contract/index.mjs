/**
 * `@yc-software/qm/contract`
 *
 * The semver-stable, supported programmatic surface used by conformance tests.
 * It contains only config loading, layer validation/parsing, env derivation,
 * approval compilation, the contract version, and provider ids. It registers no
 * runtime plugins and has no runtime dependencies.
 *
 * A new incompatible directory shape increments the contract major; a CLI may
 * add optional fields within a major.
 */

export { CONTRACT_VERSION, CONTRACT_FLOOR, checkContractMajor } from "./version.mjs";
export { parseJsonc } from "./jsonc.mjs";
export {
  parseConfig,
  validateConfig,
  TARGETS,
} from "./config.mjs";
export {
  deriveEnv,
  parsePublicUrl,
  isHttpsPublicUrl,
  DERIVED_ENV_KEYS,
} from "./env.mjs";
export { compileApprovals, effectiveBinary } from "./approvals.mjs";
export {
  validateSandboxLayer,
  validateToolDescriptor,
  validateSkill,
} from "./layer.mjs";
export { isValidFargateSize, fargateCpuValues } from "./fargate.mjs";
export { PROVIDER_IDS, isKnownProvider } from "./providers.mjs";
