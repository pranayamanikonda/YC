/**
 * The watch report: one markdown artefact per video, shaped for wiki ingest.
 *
 * The engine writes what it can measure (frontmatter, pacing numbers, the
 * word-level hook trace, the transcript, the frame index). Everything that needs
 * judgement is emitted as a `[[FILL]]` marker with its brief — the same sentinel
 * `wiki lint` blocks on — so an unsynthesized report is detectable, not merely
 * disappointing.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { formatTime } from "./timeline.mjs";

/**
 * @param {string} hint What the agent must write here.
 * @returns {string} a fill marker.
 */
function fill(hint) {
  return `[[FILL]] — ${hint}`;
}

/**
 * Build the report body.
 * @param {object} r
 * @param {string} r.source URL or path as the human gave it.
 * @param {string} r.title
 * @param {number} r.durationSeconds
 * @param {string} r.intent Why the human is watching — the lens for the whole report.
 * @param {Array<{start: number, text: string}>} r.transcriptSegments
 * @param {string | null} r.transcriptSource
 * @param {Array<{timestampSeconds: number, path: string, rel?: string}>} r.frames Frame `rel` paths (relative to the working directory) are what the artefact records — absolute host paths do not belong in a committed file.
 * @param {Array<{timestampSeconds: number, path: string}>} r.heroFrames
 * @param {object} r.pacing From computePacing.
 * @param {{ ran: boolean, skippedReason?: string, frames?: Array<object>, words?: Array<object> }} r.hook
 * @param {string} r.watchedAt ISO timestamp.
 * @returns {string} markdown.
 */
export function renderReport(r) {
  const heroNames = (r.heroFrames || []).map((f) => basename(f.path));
  const heroPaths = new Set((r.heroFrames || []).map((f) => f.path));
  const out = [];

  out.push("---");
  out.push(`source: ${r.source}`);
  out.push(`title: ${r.title}`);
  out.push(`duration: ${formatTime(r.durationSeconds)}`);
  out.push(`watched_at: ${r.watchedAt}`);
  out.push(`intent: ${r.intent || "(none given)"}`);
  out.push(`hero_frames: [${heroNames.join(", ")}]`);
  out.push(`transcript_source: ${r.transcriptSource || "none"}`);
  out.push("---");
  out.push("", `# ${r.title}`, "");

  out.push("## TL;DR", "");
  out.push(fill(`3-5 bullets through the lens of: "${r.intent || "general summary"}"`), "");

  out.push("## Key moments", "");
  out.push(fill("5-10 bullets as `- **[MM:SS] label** — what happens`; cite a frame filename where the visual carries the point"), "");

  out.push("## Hook microscope (0-10s)", "");
  if (!r.hook?.ran) {
    out.push(`_Skipped: ${r.hook?.skippedReason || "n/a"}._`);
  } else {
    out.push(`- Frames: ${(r.hook.frames || []).length} at 2 fps`);
    const words = r.hook.words || [];
    if (words.length) {
      out.push(`- Word-level transcript (${words.length} words):`, "", "```");
      for (const w of words) out.push(`  [${w.start.toFixed(2).padStart(6)}s] ${w.word}`);
      out.push("```");
    }
    out.push("");
    out.push(fill("frame-by-frame: what changes on screen at each tick, against the word landing at that moment; name the hook pattern (question, contrarian claim, in-medias-res, demo-first, …)"));
  }
  out.push("");

  out.push("## Editorial profile", "");
  if (r.pacing?.shotCount > 0) {
    out.push(`- Shots: ${r.pacing.shotCount}`);
    out.push(`- Cuts/min: ${r.pacing.cutsPerMinute}`);
    out.push(`- Mean shot length: ${r.pacing.meanShotLength}s`);
    out.push(`- Median shot length: ${r.pacing.medianShotLength}s`);
  } else {
    out.push("_No scene-change data — a static or screen-recorded source._");
  }
  out.push("");
  out.push(fill("one-line style fingerprint inferred from the pacing numbers and the hero frames"), "");

  out.push("## Quotable moments", "");
  out.push(fill("3-5 punchy, standalone lines from the transcript, each with its [MM:SS]"), "");

  out.push("## Entities", "");
  out.push(fill("people · organisations · tools/products · places, as `[[wikilink]]`-ready kebab-case names; these become wiki/entities/ pages"), "");

  out.push("## Concepts", "");
  out.push(fill("frameworks, mental models, named patterns — `name: one-line gist` each; these become wiki/patterns/ or wiki/glossary/ pages"), "");

  out.push("## Transcript", "");
  if (r.transcriptSegments?.length) {
    out.push(`_Source: ${r.transcriptSource || "unknown"}._`, "", "```");
    for (const seg of r.transcriptSegments) out.push(`[${formatTime(seg.start)}] ${String(seg.text).trim()}`);
    out.push("```");
  } else {
    out.push("_No transcript available._");
  }
  out.push("");

  out.push("## Frames", "");
  out.push(`_${(r.frames || []).length} frames sampled into the working directory; the hero frames marked \`*\` are the ones staged into the project as assets, and sit beside this report._`, "");
  for (const f of r.frames || []) {
    out.push(`${heroPaths.has(f.path) ? "* " : "  "}\`${f.rel || basename(f.path)}\` (t=${formatTime(f.timestampSeconds)})`);
  }
  out.push("");

  return out.join("\n");
}

/**
 * @param {string} outPath
 * @param {object} report Same shape as renderReport's argument.
 * @returns {string} outPath.
 */
export function writeReport(outPath, report) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderReport(report));
  return outPath;
}

/**
 * Count the fill markers still standing — the check before a report is worth
 * ingesting, since an unsynthesized one produces empty wiki pages.
 * @param {string} pathOrText
 * @param {{ isText?: boolean }} [opts]
 * @returns {number}
 */
export function pendingFills(pathOrText, opts = {}) {
  const text = opts.isText ? pathOrText : readFileSync(pathOrText, "utf8");
  return (text.match(/\[\[FILL\]\]/g) || []).length;
}
