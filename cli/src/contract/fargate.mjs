/**
 * Valid AWS Fargate CPU/memory combinations, per the ECS task-size table. The
 * reference AWS module rejects a workload whose CPU/memory pair is not one of
 * these, so the contract validates it statically.
 */

/** @type {ReadonlyArray<{ cpu: number, min: number, max: number, step: number }>} */
const TABLE = [
  { cpu: 256, min: 512, max: 2048, step: 512 }, // 512, 1024, 2048
  { cpu: 512, min: 1024, max: 4096, step: 1024 },
  { cpu: 1024, min: 2048, max: 8192, step: 1024 },
  { cpu: 2048, min: 4096, max: 16384, step: 1024 },
  { cpu: 4096, min: 8192, max: 30720, step: 1024 },
  { cpu: 8192, min: 16384, max: 61440, step: 4096 },
  { cpu: 16384, min: 32768, max: 122880, step: 8192 },
];

/**
 * @param {unknown} cpu vCPU units (256 = 0.25 vCPU).
 * @param {unknown} memory Memory in MiB.
 * @returns {boolean}
 */
export function isValidFargateSize(cpu, memory) {
  if (typeof cpu !== "number" || typeof memory !== "number") return false;
  const row = TABLE.find((r) => r.cpu === cpu);
  if (!row) return false;
  if (memory < row.min || memory > row.max) return false;
  return (memory - row.min) % row.step === 0;
}

/** @returns {number[]} The supported CPU values, ascending. */
export function fargateCpuValues() {
  return TABLE.map((r) => r.cpu);
}
