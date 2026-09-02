/**
 * The ffmpeg/ffprobe boundary: probe a video, extract frames, extract audio.
 *
 * Every subprocess call lives here so the rest of the skill stays pure and
 * testable. Frames come out as JPEGs the agent reads back as images.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { autoFps } from "./timeline.mjs";

/** Binaries the skill shells out to, and what each one is for. */
export const BINARIES = {
  ffmpeg: "frame + audio extraction",
  ffprobe: "video metadata",
  "yt-dlp": "downloading a video from a URL",
};

/**
 * Locate an executable on PATH (no shell, so a missing binary is a clean null).
 * @param {string} bin
 * @returns {string | null} absolute path, or null.
 */
export function which(bin) {
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (!dir) continue;
    const full = join(dir, bin);
    try {
      if (statSync(full).isFile()) return full;
    } catch {
      /* not here */
    }
  }
  return null;
}

/**
 * @param {string} bin
 * @returns {string} the resolved binary path.
 * @throws when the binary is not installed.
 */
function require_(bin) {
  const found = which(bin);
  if (!found) throw new Error(`${bin} is not installed (needed for ${BINARIES[bin] || bin}) — run \`watch.mjs check\` for install commands`);
  return found;
}

/**
 * @param {string} bin
 * @param {string[]} args
 * @param {{ inherit?: boolean }} [opts]
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function run(bin, args, opts = {}) {
  const res = spawnSync(require_(bin), args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: opts.inherit ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
  });
  if (res.error) throw res.error;
  return { status: res.status ?? 1, stdout: res.stdout || "", stderr: res.stderr || "" };
}

/**
 * Probe a video's duration, dimensions, codec, and whether it has audio.
 * @param {string} videoPath
 * @returns {{ durationSeconds: number, width: number | null, height: number | null, codec: string | null, sizeBytes: number, hasAudio: boolean }}
 */
export function probe(videoPath) {
  const { status, stdout, stderr } = run("ffprobe", [
    "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", resolve(videoPath),
  ]);
  if (status !== 0) throw new Error(`ffprobe failed: ${stderr.trim()}`);
  const data = JSON.parse(stdout || "{}");
  const streams = data.streams || [];
  const format = data.format || {};
  const video = streams.find((s) => s.codec_type === "video") || {};
  return {
    durationSeconds: Number(format.duration || video.duration || 0),
    width: video.width ?? null,
    height: video.height ?? null,
    codec: video.codec_name ?? null,
    sizeBytes: Number(format.size || 0),
    hasAudio: streams.some((s) => s.codec_type === "audio"),
  };
}

/**
 * @param {string} dir
 * @returns {string[]} sorted absolute paths of the frame JPEGs in dir.
 */
function frameFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^frame_\d+\.jpg$/.test(f)).sort().map((f) => join(dir, f));
}

/**
 * @param {string} dir
 */
function resetDir(dir) {
  mkdirSync(dir, { recursive: true });
  for (const f of frameFiles(dir)) rmSync(f, { force: true });
}

/**
 * @param {{ startSeconds?: number | null, endSeconds?: number | null }} range
 * @returns {string[]} ffmpeg seek args (before -i, so the seek is fast).
 */
function seekArgs(range) {
  const args = [];
  if (range.startSeconds !== null && range.startSeconds !== undefined) args.push("-ss", range.startSeconds.toFixed(3));
  if (range.endSeconds !== null && range.endSeconds !== undefined) args.push("-to", range.endSeconds.toFixed(3));
  return args;
}

/**
 * Extract frames at a uniform rate.
 * @param {object} opts
 * @param {string} opts.videoPath
 * @param {string} opts.outDir
 * @param {number} opts.fps
 * @param {number} [opts.resolution] Frame width in px.
 * @param {number} [opts.maxFrames]
 * @param {number | null} [opts.startSeconds]
 * @param {number | null} [opts.endSeconds]
 * @returns {Array<{ index: number, timestampSeconds: number, path: string, source: "uniform" }>}
 */
export function extractUniform(opts) {
  const { videoPath, outDir, fps } = opts;
  const resolution = opts.resolution ?? 512;
  const maxFrames = opts.maxFrames ?? 100;
  resetDir(outDir);

  const { status, stderr } = run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    ...seekArgs(opts),
    "-i", resolve(videoPath),
    "-vf", `fps=${fps},scale=${resolution}:-2`,
    "-frames:v", String(maxFrames),
    "-q:v", "4",
    join(outDir, "frame_%04d.jpg"),
  ]);
  if (status !== 0) throw new Error(`ffmpeg frame extraction failed: ${stderr.trim()}`);

  const offset = opts.startSeconds || 0;
  return frameFiles(outDir).map((path, index) => ({
    index,
    timestampSeconds: Math.round((offset + (fps > 0 ? index / fps : 0)) * 100) / 100,
    path,
    source: "uniform",
  }));
}

/**
 * Pull `pts_time` values out of ffmpeg's `metadata=mode=print` output.
 *
 * The filter writes to stdout on some builds and stderr on others, and spells
 * the value `pts_time:N` or `pts_time=N` depending on version — so scan both
 * streams for both spellings.
 * @param {string} text
 * @returns {number[]}
 */
export function parseSceneTimes(text) {
  const times = [];
  for (const match of String(text).matchAll(/pts_time[:=]\s*([0-9]+(?:\.[0-9]+)?)/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) times.push(value);
  }
  return times;
}

/**
 * Extract one frame per detected shot (scene-change sampling).
 *
 * ffmpeg's `select='gt(scene,T)'` scores each frame's visual difference from the
 * last in [0,1]; 0.3 catches hard cuts and most dissolves without firing on
 * ordinary motion. Frame 0 is always emitted, since the filter only fires on
 * *changes* and would otherwise skip the opening shot.
 *
 * A static source (screen recording, single-take talking head) yields almost no
 * cuts; below `uniformFallbackMin` frames we fall back to uniform sampling,
 * because sparse frames beat almost none.
 * @param {object} opts
 * @param {string} opts.videoPath
 * @param {string} opts.outDir
 * @param {number} [opts.sceneThreshold]
 * @param {number} [opts.resolution]
 * @param {number} [opts.maxFrames]
 * @param {number} [opts.uniformFallbackMin]
 * @param {number | null} [opts.startSeconds]
 * @param {number | null} [opts.endSeconds]
 * @param {number} [opts.rangeDuration] Duration of the analysed range, for the fallback budget.
 * @returns {Array<{ index: number, timestampSeconds: number, path: string, source: "scene-change" | "uniform" }>}
 */
export function extractSceneChange(opts) {
  const { videoPath, outDir } = opts;
  const threshold = opts.sceneThreshold ?? 0.3;
  const resolution = opts.resolution ?? 512;
  const maxFrames = opts.maxFrames ?? 100;
  const fallbackMin = opts.uniformFallbackMin ?? 10;
  resetDir(outDir);

  const select = `eq(n\\,0)+gt(scene\\,${threshold})`;
  const { status, stdout, stderr } = run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    ...seekArgs(opts),
    "-i", resolve(videoPath),
    "-vf", `select='${select}',metadata=mode=print:file=-,scale=${resolution}:-2`,
    "-vsync", "vfr",
    "-frames:v", String(maxFrames),
    "-q:v", "4",
    join(outDir, "frame_%04d.jpg"),
  ]);
  if (status !== 0) throw new Error(`ffmpeg scene-change extraction failed: ${stderr.trim()}`);

  const files = frameFiles(outDir);
  if (files.length < fallbackMin) {
    const duration = opts.rangeDuration ?? probe(videoPath).durationSeconds;
    const { fps } = autoFps(Math.max(0.1, duration), maxFrames);
    return extractUniform({ ...opts, fps, resolution, maxFrames });
  }

  const times = parseSceneTimes(`${stdout}\n${stderr}`);
  const offset = opts.startSeconds || 0;
  return files.map((path, index) => ({
    index,
    timestampSeconds: Math.round((offset + (times[index] ?? 0)) * 100) / 100,
    path,
    source: "scene-change",
  }));
}

/**
 * Extract a mono 16 kHz mp3 — ~0.5 MB/min, small enough for any Whisper limit.
 * @param {string} videoPath
 * @param {string} outPath
 * @param {{ durationSeconds?: number }} [opts] Optional clip length from t=0.
 * @returns {string} outPath.
 */
export function extractAudio(videoPath, outPath, opts = {}) {
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  const clip = opts.durationSeconds ? ["-t", String(opts.durationSeconds)] : [];
  const { status, stderr } = run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", resolve(videoPath),
    "-vn", "-acodec", "libmp3lame", "-ar", "16000", "-ac", "1", "-b:a", "64k",
    ...clip,
    resolve(outPath),
  ]);
  if (status !== 0) throw new Error(`ffmpeg audio extraction failed: ${stderr.trim()}`);
  if (!existsSync(outPath) || statSync(outPath).size === 0) {
    throw new Error("ffmpeg produced no audio — the video may have no audio track");
  }
  return outPath;
}

export const __testing = { run, frameFiles };
