/**
 * Project IO: read/write the manifest and ledger a scaffolded project carries.
 * Compatible with what prd-intake writes (same manifest.json + ledger format).
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GATES } from "./model.mjs";

/**
 * @param {string} projectDir
 * @returns {{ manifestPath: string, ledgerPath: string }}
 */
export function paths(projectDir) {
  const manifestPath = join(projectDir, ".harness", "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`not a harness project (no .harness/manifest.json): ${projectDir}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const ledgerPath = join(projectDir, ".harness", "ledger", `${manifest.project}.md`);
  return { manifestPath, ledgerPath };
}

/**
 * @param {string} projectDir
 * @returns {any} manifest with gates defaulted.
 */
export function loadManifest(projectDir) {
  const { manifestPath } = paths(projectDir);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!manifest.gates) {
    manifest.gates = Object.fromEntries(GATES.map((g) => [g, "pending"]));
  }
  return manifest;
}

/**
 * @param {string} projectDir
 * @param {any} manifest
 */
export function saveManifest(projectDir, manifest) {
  const { manifestPath } = paths(projectDir);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

/**
 * Append a dated line to the ledger.
 * @param {string} projectDir
 * @param {string} line
 * @param {string} date ISO date.
 */
export function ledger(projectDir, line, date) {
  const { ledgerPath } = paths(projectDir);
  appendFileSync(ledgerPath, `- ${date} · ${line}\n`);
}

/**
 * @param {string} dir
 * @returns {boolean} whether the directory has any regular file.
 */
export function hasFiles(dir) {
  if (!existsSync(dir)) return false;
  return readdirSync(dir, { withFileTypes: true }).some((d) => d.isFile());
}
