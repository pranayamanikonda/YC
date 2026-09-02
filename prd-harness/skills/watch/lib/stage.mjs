/**
 * Make a watch durable: move the report and its hero frames out of the ephemeral
 * working directory into the project, then hand the report to the wiki as a
 * source so what the video taught survives the session.
 *
 * The working directory holds a video, up to 100 frames, and an audio clip —
 * none of which belong in git. What survives is the report plus 3-5 hero frames.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ingest as ingestAsset } from "../../assets-intake/ingest.mjs";
import { ingest as ingestWiki, parsePage } from "../../wiki/wiki.mjs";
import { pendingFills } from "./report.mjs";
import { slugify } from "./source.mjs";

/** Where staged watches live under the project's assets/. */
export const WATCHED_DIR = "watched";

/**
 * Find a hero frame by basename. `frames/` is searched first and by name, because
 * the hook pass writes frames under the same numbering in its own directory and
 * the frontmatter names the main sample.
 * @param {string} workDir
 * @param {string} name
 * @returns {string | null}
 */
function findFrame(workDir, name) {
  const primary = join(workDir, "frames", name);
  if (existsSync(primary) && statSync(primary).isFile()) return primary;
  return walk(workDir, name);
}

/**
 * @param {string} root
 * @param {string} name
 * @returns {string | null} the first match in a deterministic (sorted) walk.
 */
function walk(root, name) {
  if (!existsSync(root)) return null;
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isFile() && entry.name === name) return join(root, entry.name);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const hit = walk(join(root, entry.name), name);
    if (hit) return hit;
  }
  return null;
}

/**
 * Read a watch report's frontmatter.
 * @param {string} reportPath
 * @returns {{ frontmatter: Record<string, any>, heroFrames: string[] }}
 */
export function readReportMeta(reportPath) {
  const { frontmatter } = parsePage(readFileSync(reportPath, "utf8"));
  const heroFrames = String(frontmatter.hero_frames || "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { frontmatter, heroFrames };
}

/**
 * Stage a completed watch into a project.
 * @param {object} opts
 * @param {string} opts.projectDir A scaffolded harness project.
 * @param {string} opts.workDir The working directory `watch run` printed.
 * @param {string} [opts.type] Wiki page type for the ingested source (default `entity`).
 * @param {string} [opts.page] Wiki page slug (default: the report's slug).
 * @param {boolean} [opts.wiki] Set false to stage the assets without scaffolding a wiki page.
 * @param {string} [opts.date] ISO date.
 * @returns {{ slug: string, subdir: string, reportPath: string, assets: string[], skipped: string[], wikiPage: string | null }}
 * @throws when the report still has `[[FILL]]` markers — an unsynthesized report
 *   ingests into empty wiki pages, so it is refused rather than half-ingested.
 */
export function stageWatch(opts) {
  const { projectDir, workDir } = opts;
  if (!projectDir) throw new Error("projectDir is required");
  if (!workDir) throw new Error("workDir is required");
  const date = opts.date || new Date().toISOString().slice(0, 10);

  const reportPath = join(workDir, "report.md");
  if (!existsSync(reportPath)) throw new Error(`no report.md in ${workDir} — run \`watch.mjs run\` first`);

  const unfilled = pendingFills(reportPath);
  if (unfilled > 0) {
    throw new Error(`report has ${unfilled} unfilled [[FILL]] marker${unfilled === 1 ? "" : "s"} — synthesize ${reportPath} before staging`);
  }

  const { frontmatter, heroFrames } = readReportMeta(reportPath);
  const slug = opts.page || slugify(frontmatter.title, date);
  const subdir = `${WATCHED_DIR}/${slug}`;

  const files = [reportPath];
  for (const name of heroFrames) {
    const found = findFrame(workDir, name);
    if (found) files.push(found);
  }

  const res = ingestAsset({ projectDir, files, subdir, date });
  const staged = res.ingested.map((a) => a.name);
  const reportAsset = [...staged, ...res.skipped.map((s) => s.name)].find((n) => n.endsWith("report.md"));

  let wikiPage = null;
  if (opts.wiki !== false && reportAsset) {
    wikiPage = ingestWiki(projectDir, {
      source: join("assets", reportAsset),
      type: opts.type || "entity",
      page: slug,
      date,
    }).path;
  }

  return {
    slug,
    subdir,
    reportPath: reportAsset ? join("assets", reportAsset) : null,
    assets: staged,
    skipped: res.skipped.map((s) => `${s.name} (${s.reason})`),
    wikiPage,
  };
}
