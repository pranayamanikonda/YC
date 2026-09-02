/**
 * assets-intake — bring uploaded/attached files into a project so they are
 * tracked and durable.
 *
 * Copies each source file into `<project>/assets/`, records it in the manifest
 * (name, sha256, size, source, ingest date) and the ledger, and de-duplicates by
 * content hash. Name collisions with *different* content get a short hash suffix
 * so nothing is silently overwritten.
 *
 * CLI:  node ingest.mjs <projectDir> [--subdir <rel>] <file...>
 * API:  ingest({ projectDir, files, date, subdir })
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createHash } from "node:crypto";
import { loadManifest, saveManifest, ledger } from "../pipeline/lib/project.mjs";

/**
 * @param {Buffer} buf
 * @returns {string} sha256 hex.
 */
function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * @param {string} name
 * @returns {string} a filesystem-safe base name.
 */
function safeName(name) {
  return basename(name).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

/**
 * @param {string | undefined} subdir
 * @returns {string} a safe relative folder under assets/, or "" for none.
 */
function normalizeSubdir(subdir) {
  if (!subdir) return "";
  const parts = String(subdir).split("/").map((s) => s.trim()).filter(Boolean);
  if (parts.some((s) => s === "." || s === ".." || s.includes("\\"))) {
    throw new Error(`invalid subdir: ${subdir}`);
  }
  return parts.map((s) => s.replace(/[^A-Za-z0-9._-]+/g, "-")).join("/");
}

/**
 * Ingest files into a project's assets/.
 * @param {object} opts
 * @param {string} opts.projectDir
 * @param {string[]} opts.files Source file paths.
 * @param {string} [opts.date] ISO date.
 * @param {string} [opts.subdir] Folder under `assets/` to group the files in (e.g. `watched/<slug>`).
 * @returns {{ ingested: Array<object>, skipped: Array<object> }}
 */
export function ingest(opts) {
  const { projectDir, files } = opts;
  if (!projectDir) throw new Error("projectDir is required");
  if (!Array.isArray(files) || files.length === 0) throw new Error("at least one file is required");
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const subdir = normalizeSubdir(opts.subdir);
  if (subdir) mkdirSync(join(projectDir, "assets", subdir), { recursive: true });

  const manifest = loadManifest(projectDir);
  if (!Array.isArray(manifest.assets)) manifest.assets = [];
  const byHash = new Map(manifest.assets.map((a) => [a.sha256, a]));

  const ingested = [];
  const skipped = [];

  for (const src of files) {
    if (!existsSync(src)) throw new Error(`source file not found: ${src}`);
    const buf = readFileSync(src);
    const hash = sha256(buf);

    // Already ingested identical content — skip (idempotent).
    if (byHash.has(hash)) {
      skipped.push({ source: src, name: byHash.get(hash).name, reason: "duplicate content" });
      continue;
    }

    // Resolve a non-colliding destination name.
    const base = safeName(src);
    let destName = base;
    const destPath = () => join(projectDir, "assets", subdir, destName);
    if (existsSync(destPath())) {
      const ext = extname(base);
      const stem = ext ? base.slice(0, -ext.length) : base;
      destName = `${stem}-${hash.slice(0, 8)}${ext}`;
    }
    copyFileSync(src, destPath());

    const record = {
      // Name is the path under assets/, so grouped ingests stay addressable.
      name: subdir ? `${subdir}/${destName}` : destName,
      sha256: hash,
      bytes: buf.length,
      source: basename(src),
      ingestedAt: date,
    };
    manifest.assets.push(record);
    byHash.set(hash, record);
    ingested.push(record);
  }

  saveManifest(projectDir, manifest);
  if (ingested.length) {
    ledger(projectDir, `assets ingested: [${ingested.map((a) => a.name).join(", ")}]`, date);
  }
  return { ingested, skipped };
}

// ---------- CLI ----------
import { fileURLToPath } from "node:url";
if (process.argv[1] && basename(process.argv[1]) === "ingest.mjs" && process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , projectDir, ...rest] = process.argv;
  let subdir;
  const files = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--subdir") subdir = rest[++i];
    else files.push(rest[i]);
  }
  if (!projectDir || files.length === 0) {
    process.stderr.write("usage: node ingest.mjs <projectDir> [--subdir <rel>] <file...>\n");
    process.exit(1);
  }
  const res = ingest({ projectDir, files, subdir });
  for (const a of res.ingested) process.stdout.write(`+ ${a.name}  (${a.bytes} bytes, ${a.sha256.slice(0, 12)}…)\n`);
  for (const s of res.skipped) process.stdout.write(`= ${s.name}  (${s.reason})\n`);
}
