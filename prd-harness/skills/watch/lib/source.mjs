/**
 * Resolve what the human handed you into a local video file: a URL goes through
 * yt-dlp (which also fetches native captions, the free transcript path); a local
 * path is used in place, with no copy and no download.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { which } from "./media.mjs";

/** Extensions treated as video without comment; anything else warns but proceeds. */
export const VIDEO_EXTS = new Set([".mp4", ".mkv", ".webm", ".mov", ".m4v", ".avi", ".flv", ".wmv"]);

/**
 * @param {string} source
 * @returns {boolean} whether the source is an http(s) URL rather than a path.
 */
export function isUrl(source) {
  if (!source || source.startsWith("-")) return false;
  try {
    const url = new URL(source);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.host);
  } catch {
    return false;
  }
}

/**
 * @param {string} path
 * @returns {string} path with a leading `~` expanded.
 */
function expandHome(path) {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

/**
 * @param {string} path
 * @param {(msg: string) => void} warn
 * @returns {{ videoPath: string, subtitlePath: null, info: { title: string, url: string }, downloaded: false }}
 */
export function resolveLocal(path, warn = () => {}) {
  const full = resolve(expandHome(path));
  if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`file not found: ${full}`);
  const ext = extname(full).toLowerCase();
  if (!VIDEO_EXTS.has(ext)) warn(`${ext || "(no extension)"} is not a known video extension — proceeding anyway`);
  return { videoPath: full, subtitlePath: null, info: { title: basename(full, ext), url: full }, downloaded: false };
}

/**
 * @param {string} dir
 * @returns {string | null} the best subtitle file yt-dlp left behind.
 */
function pickSubtitle(dir) {
  const vtts = readdirSync(dir).filter((f) => f.startsWith("video") && f.endsWith(".vtt")).sort();
  if (!vtts.length) return null;
  return join(dir, vtts.find((f) => f.includes(".en")) || vtts[0]);
}

/**
 * @param {string} dir
 * @returns {string | null} the downloaded video file.
 */
function pickVideo(dir) {
  const files = readdirSync(dir).filter((f) => f.startsWith("video."));
  for (const ext of [".mp4", ".mkv", ".webm", ".mov"]) {
    const hit = files.find((f) => f.toLowerCase().endsWith(ext));
    if (hit) return join(dir, hit);
  }
  const any = files.find((f) => VIDEO_EXTS.has(extname(f).toLowerCase()));
  return any ? join(dir, any) : null;
}

/**
 * Download a video (and its captions) with yt-dlp.
 * @param {string} url
 * @param {string} outDir
 * @param {(msg: string) => void} [warn]
 * @returns {{ videoPath: string, subtitlePath: string | null, info: object, downloaded: true }}
 */
export function downloadUrl(url, outDir, warn = () => {}) {
  if (!which("yt-dlp")) throw new Error("yt-dlp is not installed — run `watch.mjs check` for install commands");
  mkdirSync(outDir, { recursive: true });

  // 720p keeps the download small; frames are downscaled to ~512px anyway.
  const res = spawnSync(which("yt-dlp"), [
    "-N", "8",
    "-f", "bv*[height<=720]+ba/b[height<=720]/bv+ba/b",
    "--merge-output-format", "mp4",
    "--write-info-json", "--write-subs", "--write-auto-subs",
    "--sub-langs", "en,en-US,en-GB,en-orig", "--sub-format", "vtt", "--convert-subs", "vtt",
    "--no-playlist", "--ignore-errors",
    "-o", join(outDir, "video.%(ext)s"),
    "--", url,
  ], { stdio: ["ignore", "inherit", "inherit"] });
  if (res.error) throw res.error;

  // yt-dlp exits non-zero when a *subtitle* variant fails even though the video
  // arrived intact, so the presence of the file is the success test, not the code.
  const videoPath = pickVideo(outDir);
  if (!videoPath) throw new Error(`yt-dlp produced no video file in ${outDir} (exit ${res.status})`);

  let info = { url };
  const infoPath = join(outDir, "video.info.json");
  if (existsSync(infoPath)) {
    try {
      const raw = JSON.parse(readFileSync(infoPath, "utf8"));
      info = { title: raw.title, uploader: raw.uploader || raw.channel, duration: raw.duration, url: raw.webpage_url || url };
    } catch (err) {
      warn(`info.json parse failed: ${err.message}`);
    }
  }
  return { videoPath, subtitlePath: pickSubtitle(outDir), info, downloaded: true };
}

/**
 * @param {string} source URL or local path.
 * @param {string} outDir Where a download lands (unused for local files).
 * @param {(msg: string) => void} [warn]
 * @returns {{ videoPath: string, subtitlePath: string | null, info: object, downloaded: boolean }}
 */
export function resolveSource(source, outDir, warn) {
  return isUrl(source) ? downloadUrl(source, outDir, warn) : resolveLocal(source, warn);
}

/**
 * Slugify a title into a stable, filesystem- and wikilink-safe directory name.
 * @param {string} title
 * @param {string} date ISO date (YYYY-MM-DD), appended so re-watches don't collide.
 * @returns {string}
 */
export function slugify(title, date) {
  const base = String(title || "video")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60).replace(/-+$/g, "") || "video";
  return `${base}-${date}`;
}

export const __testing = { pickVideo, pickSubtitle, expandHome };
