/**
 * Pure timeline maths for /watch: timecodes, the frame budget, editorial pacing,
 * and hero-frame selection.
 *
 * Nothing here shells out, so the parts that decide how many frames a video is
 * worth are testable without ffmpeg on the box.
 */

/** Hard ceiling on sampling rate — above this the frame budget stops buying detail. */
export const MAX_FPS = 2.0;
/** The hook microscope's window, in seconds. */
export const HOOK_SECONDS = 10.0;
/** Videos shorter than this are all hook; the microscope adds nothing. */
export const HOOK_MIN_DURATION = 30.0;

/**
 * Parse `SS`, `MM:SS`, or `HH:MM:SS` (fractional seconds allowed) into seconds.
 * @param {string | number | null | undefined} value
 * @returns {number | null} null when there is nothing to parse.
 */
export function parseTime(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`cannot parse time value: ${value}`);
    return value;
  }
  const s = String(value).trim();
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || !/^\d+(\.\d+)?$/.test(p))) {
    throw new Error(`cannot parse time value: "${value}" (expected SS, MM:SS, or HH:MM:SS)`);
  }
  const nums = parts.map(Number);
  const seconds = nums.reduce((acc, n) => acc * 60 + n, 0);
  return seconds;
}

/**
 * Format seconds as `MM:SS`, or `H:MM:SS` past the hour.
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * @param {number} fps
 * @param {number} duration
 * @param {number} maxFrames
 * @returns {{ fps: number, target: number }}
 */
function clamp(fps, duration, maxFrames) {
  const capped = Math.min(fps, MAX_FPS);
  return { fps: capped, target: Math.min(maxFrames, Math.max(1, Math.round(capped * duration))) };
}

/**
 * Frame budget for a full-video scan. Budget by duration, not a fixed rate:
 * image tokens dominate cost, so short videos stay dense and long ones stay capped.
 * @param {number} duration Seconds.
 * @param {number} [maxFrames]
 * @returns {{ fps: number, target: number }}
 */
export function autoFps(duration, maxFrames = 100) {
  if (!(duration > 0)) return { fps: 1.0, target: 1 };
  let target;
  if (duration <= 30) target = Math.min(maxFrames, Math.max(12, Math.round(duration)));
  else if (duration <= 60) target = Math.min(maxFrames, 40);
  else if (duration <= 180) target = Math.min(maxFrames, 60);
  else if (duration <= 600) target = Math.min(maxFrames, 80);
  else target = maxFrames;
  return clamp(target / duration, duration, maxFrames);
}

/**
 * Frame budget for a user-named range — denser, because they are zooming in.
 * @param {number} duration Seconds.
 * @param {number} [maxFrames]
 * @returns {{ fps: number, target: number }}
 */
export function autoFpsFocus(duration, maxFrames = 100) {
  if (!(duration > 0)) return { fps: MAX_FPS, target: 2 };
  let target;
  if (duration <= 5) target = Math.min(maxFrames, Math.max(10, Math.round(duration * 6)));
  else if (duration <= 15) target = Math.min(maxFrames, Math.max(30, Math.round(duration * 4)));
  else if (duration <= 30) target = Math.min(maxFrames, 60);
  else if (duration <= 60) target = Math.min(maxFrames, 80);
  else target = maxFrames;
  return clamp(target / duration, duration, maxFrames);
}

/**
 * Editorial pacing from shot-start timestamps: how fast the video cuts.
 * @param {number[]} sceneTimes Shot starts in seconds (any order).
 * @param {number} duration Duration of the analysed range, seconds.
 * @returns {{ shotCount: number, cutsPerMinute: number, meanShotLength: number, medianShotLength: number, shots: Array<{startSeconds: number, durationSeconds: number}> }}
 */
export function computePacing(sceneTimes, duration) {
  const empty = { shotCount: 0, cutsPerMinute: 0, meanShotLength: 0, medianShotLength: 0, shots: [] };
  if (!Array.isArray(sceneTimes) || sceneTimes.length === 0 || !(duration > 0)) return empty;

  const times = [...sceneTimes].sort((a, b) => a - b);
  if (times[0] > 0.01) times.unshift(0);

  const shots = times.map((start, i) => {
    const end = i + 1 < times.length ? times[i + 1] : duration;
    return { startSeconds: round2(start), durationSeconds: round2(Math.max(0, end - start)) };
  });

  const durations = shots.map((s) => s.durationSeconds).sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  const median = durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;

  return {
    shotCount: shots.length,
    cutsPerMinute: round2(shots.length / (duration / 60)),
    meanShotLength: round2(durations.reduce((a, b) => a + b, 0) / durations.length),
    medianShotLength: round2(median),
    shots,
  };
}

/**
 * Pick the 3-5 frames worth carrying into the project as durable assets.
 *
 * Deterministic heuristic: the opening shot (whatever the hook shows), the start
 * of the longest sustained shot (where the video dwells), then evenly-spaced
 * fill. The rest of the frames stay in the ephemeral working directory.
 * @param {Array<{timestampSeconds: number, path: string}>} frames
 * @param {{ shots?: Array<{startSeconds: number, durationSeconds: number}> }} [pacing]
 * @param {{ max?: number, min?: number, hookEnd?: number }} [opts]
 * @returns {Array<{timestampSeconds: number, path: string}>}
 */
export function selectHeroFrames(frames, pacing, opts = {}) {
  if (!Array.isArray(frames) || frames.length === 0) return [];
  const max = opts.max ?? 5;
  const min = opts.min ?? 3;
  const hookEnd = opts.hookEnd ?? HOOK_SECONDS;
  const chosen = [];
  const add = (i) => {
    if (i >= 0 && i < frames.length && !chosen.includes(i)) chosen.push(i);
  };
  const firstAtOrAfter = (t) => frames.findIndex((f) => f.timestampSeconds >= t);

  const opening = frames.findIndex((f) => f.timestampSeconds <= hookEnd);
  if (opening >= 0) add(opening);

  const shots = pacing?.shots ?? [];
  if (shots.length) {
    const longest = shots.reduce((a, b) => (b.durationSeconds > a.durationSeconds ? b : a));
    add(firstAtOrAfter(longest.startSeconds));
  }

  if (chosen.length < min) {
    const gap = Math.max(1, Math.floor(frames.length / max));
    for (let i = 0; i < frames.length && chosen.length < max; i += gap) add(i);
  }

  return [...new Set(chosen)].sort((a, b) => a - b).slice(0, max).map((i) => frames[i]);
}

/**
 * @param {number} n
 * @returns {number} n rounded to 2dp.
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}
