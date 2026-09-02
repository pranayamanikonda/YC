/**
 * watch — give the agent a video input.
 *
 * `run` downloads (or opens) a video, samples one frame per shot, measures the
 * cutting, microscopes the first ten seconds, and gets a timestamped transcript;
 * it prints frame paths for the agent to Read and writes an ingest-shaped
 * `report.md`. `stage` makes a synthesized report durable in a project.
 *
 * CLI:
 *   node watch.mjs check
 *   node watch.mjs run   <url-or-path> [--intent "..."] [flags]
 *   node watch.mjs stage <projectDir> <workDir> [--type <t>] [--page <slug>] [--no-wiki]
 *
 * Adapted from taoufik123-collab/claude-watch (MIT) — see CREDITS.md.
 */

import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOOK_MIN_DURATION, HOOK_SECONDS, MAX_FPS,
  autoFps, autoFpsFocus, computePacing, formatTime, parseTime, selectHeroFrames,
} from "./lib/timeline.mjs";
import { BINARIES, extractAudio, extractSceneChange, extractUniform, probe, which } from "./lib/media.mjs";
import { isUrl, resolveSource } from "./lib/source.mjs";
import { filterRange, formatTranscript, parseVtt } from "./lib/transcript.mjs";
import { BACKENDS, loadApiKey, transcribeAudio } from "./lib/whisper.mjs";
import { writeReport } from "./lib/report.mjs";
import { stageWatch } from "./lib/stage.mjs";

/** Frames beyond this stop buying understanding and start burning context. */
const HARD_MAX_FRAMES = 100;
/** Past this duration a full-video scan is too sparse to trust. */
const SPARSE_WARNING_SECONDS = 600;

const note = (msg) => process.stderr.write(`[watch] ${msg}\n`);
const say = (msg = "") => process.stdout.write(`${msg}\n`);

/**
 * What is installed, and what a transcript can come from.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ready: boolean, missing: string[], whisper: string | null }}
 */
export function preflight(env = process.env) {
  const missing = Object.keys(BINARIES).filter((bin) => !which(bin));
  const { backend } = loadApiKey(null, env);
  // yt-dlp is only needed for URLs, so its absence does not block a local file.
  return { ready: !missing.some((b) => b !== "yt-dlp"), missing, whisper: backend };
}

/**
 * @param {{ ready: boolean, missing: string[], whisper: string | null }} state
 * @returns {number} exit code.
 */
function reportPreflight(state) {
  for (const bin of state.missing) {
    say(`missing: ${bin} (${BINARIES[bin]})`);
  }
  if (state.missing.length) {
    say("");
    say("  macOS:         brew install ffmpeg yt-dlp");
    say("  Debian/Ubuntu: apt-get install -y ffmpeg && pipx install yt-dlp");
    say("");
  }
  if (state.whisper) {
    say(`whisper: ${state.whisper} (${BACKENDS[state.whisper].envVar} is set)`);
  } else {
    say(`whisper: unavailable — set ${BACKENDS.groq.envVar} (preferred) or ${BACKENDS.openai.envVar}`);
    say("         without it, a video with no captions comes back frames-only");
  }
  if (!state.missing.length) say("✓ watch is ready");
  else if (state.ready) say("✓ watch is ready for local files; URLs need yt-dlp");
  return state.ready ? 0 : 2;
}

/**
 * Watch a video: sample it, transcribe it, and write the report.
 * @param {object} opts
 * @param {string} opts.source URL or local path.
 * @param {string} [opts.intent] Why the human is watching — the report's lens.
 * @param {string} [opts.outDir] Working directory (default: a fresh temp dir).
 * @param {number} [opts.maxFrames]
 * @param {number} [opts.resolution]
 * @param {number} [opts.fps] Override the budget (disables scene-change sampling).
 * @param {string} [opts.start] Range start (SS | MM:SS | HH:MM:SS).
 * @param {string} [opts.end] Range end.
 * @param {boolean} [opts.noWhisper]
 * @param {"groq" | "openai"} [opts.whisper] Force a backend.
 * @param {boolean} [opts.noSceneChange]
 * @param {boolean} [opts.noHook]
 * @returns {Promise<object>} the run result (also rendered to stdout by the CLI).
 */
export async function run(opts) {
  const maxFrames = Math.min(opts.maxFrames ?? 80, HARD_MAX_FRAMES);
  const resolution = opts.resolution ?? 512;
  if (!(maxFrames >= 1)) throw new Error("--max-frames must be at least 1");
  if (!(resolution >= 64)) throw new Error("--resolution must be at least 64 (px wide)");
  if (opts.fps !== undefined && opts.fps !== null && !(opts.fps > 0)) throw new Error("--fps must be greater than 0");
  const workDir = opts.outDir ? resolve(opts.outDir) : mkdtempSync(join(tmpdir(), "watch-"));
  mkdirSync(workDir, { recursive: true });
  note(`working dir: ${workDir}`);

  note(isUrl(opts.source) ? "downloading via yt-dlp…" : "using local file…");
  const src = resolveSource(opts.source, join(workDir, "download"), note);
  const meta = probe(src.videoPath);
  const duration = meta.durationSeconds;

  const startSeconds = parseTime(opts.start ?? null);
  const endSeconds = parseTime(opts.end ?? null);
  if (startSeconds !== null && startSeconds < 0) throw new Error("--start must be non-negative");
  if (startSeconds !== null && endSeconds !== null && endSeconds <= startSeconds) throw new Error("--end must be greater than --start");
  if (duration > 0 && startSeconds !== null && startSeconds >= duration) {
    throw new Error(`--start ${formatTime(startSeconds)} is past the end of the video (${formatTime(duration)})`);
  }

  const focused = startSeconds !== null || endSeconds !== null;
  const rangeStart = startSeconds ?? 0;
  const rangeEnd = endSeconds ?? duration;
  const rangeDuration = Math.max(0, rangeEnd - rangeStart);

  let { fps, target } = focused ? autoFpsFocus(rangeDuration, maxFrames) : autoFps(rangeDuration, maxFrames);
  if (opts.fps !== undefined && opts.fps !== null) {
    fps = Math.min(opts.fps, MAX_FPS);
    target = Math.max(1, Math.round(fps * rangeDuration));
  }

  // Scene-change sampling is the default; a named range or an explicit fps means
  // the human asked for even coverage, so honour that instead.
  const useScene = !opts.noSceneChange && !focused && opts.fps === undefined;
  note(`sampling ~${target} frames over ${focused ? `${formatTime(rangeStart)}–${formatTime(rangeEnd)}` : `the full ${formatTime(duration)}`}…`);
  const frames = useScene
    ? extractSceneChange({ videoPath: src.videoPath, outDir: join(workDir, "frames"), resolution, maxFrames, startSeconds, endSeconds, rangeDuration })
    : extractUniform({ videoPath: src.videoPath, outDir: join(workDir, "frames"), fps, resolution, maxFrames, startSeconds, endSeconds });
  const sampling = frames[0]?.source === "scene-change" ? "scene-change" : useScene ? "uniform (scene fallback)" : "uniform";

  const pacing = computePacing(sampling === "scene-change" ? frames.map((f) => f.timestampSeconds) : [], rangeDuration);

  const key = opts.noWhisper ? { backend: null, apiKey: null } : loadApiKey(opts.whisper ?? null);
  const hook = await runHook({ ...opts, videoPath: src.videoPath, workDir, duration, focused, key, resolution });

  const transcript = await getTranscript({ ...opts, src, workDir, startSeconds, endSeconds, focused, key });

  const heroFrames = selectHeroFrames(frames, pacing);
  const heroSet = new Set(heroFrames.map((f) => f.path));
  const withRel = frames.map((f) => ({ ...f, rel: relative(workDir, f.path) }));
  const reportPath = writeReport(join(workDir, "report.md"), {
    // A URL identifies the video; a local path is a host path that has no place
    // in a committed artefact, so the artefact records the filename.
    source: isUrl(opts.source) ? opts.source : basename(opts.source),
    title: src.info?.title || basename(opts.source),
    durationSeconds: duration,
    intent: opts.intent || "",
    transcriptSegments: transcript.segments,
    transcriptSource: transcript.source,
    frames: withRel,
    heroFrames,
    pacing,
    hook,
    watchedAt: new Date().toISOString(),
  });

  return {
    workDir, reportPath, meta, src, frames, heroFrames: [...heroSet], pacing, hook, transcript,
    fps, target, focused, rangeStart, rangeEnd, rangeDuration, sampling, maxFrames, resolution,
  };
}

/**
 * The hook microscope: 2 fps over the first ten seconds plus a word-level
 * transcript, so each frame can be read against the word landing on it. The
 * opening is where a video earns or loses attention; it is worth the density.
 * @param {object} opts
 * @returns {Promise<{ ran: boolean, skippedReason?: string, frames: Array<object>, words: Array<object> }>}
 */
async function runHook(opts) {
  const skip = (reason) => ({ ran: false, skippedReason: reason, frames: [], words: [] });
  if (opts.noHook) return skip("--no-hook");
  if (opts.focused) return skip("focused mode — the range is already the microscope");
  if (opts.duration > 0 && opts.duration < HOOK_MIN_DURATION) return skip(`video under ${HOOK_MIN_DURATION}s — the whole scan is already dense`);

  note("running the hook microscope on the first 10s…");
  const frames = extractUniform({
    videoPath: opts.videoPath,
    outDir: join(opts.workDir, "hook_frames"),
    fps: 2.0,
    resolution: opts.resolution ?? 512,
    maxFrames: 25,
    startSeconds: 0,
    endSeconds: HOOK_SECONDS,
  });

  let words = [];
  if (opts.key.backend) {
    try {
      const audio = extractAudio(opts.videoPath, join(opts.workDir, "hook_audio.mp3"), { durationSeconds: HOOK_SECONDS });
      ({ words } = await transcribeAudio({ audioPath: audio, backend: opts.key.backend, apiKey: opts.key.apiKey, wordTimestamps: true, warn: note }));
    } catch (err) {
      note(`hook transcript unavailable: ${err.message}`);
    }
  }
  return { ran: true, frames, words };
}

/**
 * Get a timestamped transcript: native captions first (free and already aligned),
 * Whisper only when there are none.
 * @param {object} opts
 * @returns {Promise<{ segments: Array<object>, text: string | null, source: string | null }>}
 */
async function getTranscript(opts) {
  const { src, startSeconds, endSeconds, focused } = opts;
  const shape = (segments, source) => ({ segments, text: segments.length ? formatTranscript(segments) : null, source });

  if (src.subtitlePath) {
    try {
      const all = parseVtt(src.subtitlePath);
      const segments = focused ? filterRange(all, startSeconds, endSeconds) : all;
      note(`transcript: ${segments.length} caption segments`);
      return shape(segments, "captions");
    } catch (err) {
      note(`caption parse failed: ${err.message}`);
    }
  }

  if (opts.noWhisper) return shape([], null);
  if (!opts.key.backend) {
    note(opts.whisper
      ? `--whisper ${opts.whisper} was asked for but ${BACKENDS[opts.whisper].envVar} is not set`
      : `no captions and no Whisper key — set ${BACKENDS.groq.envVar} or ${BACKENDS.openai.envVar} for a transcript`);
    return shape([], null);
  }

  try {
    note(`no captions — transcribing with ${opts.key.backend} Whisper…`);
    const audio = extractAudio(src.videoPath, join(opts.workDir, "audio.mp3"));
    const { segments: all } = await transcribeAudio({ audioPath: audio, backend: opts.key.backend, apiKey: opts.key.apiKey, warn: note });
    const segments = focused ? filterRange(all, startSeconds, endSeconds) : all;
    note(`transcript: ${segments.length} segments via ${opts.key.backend}`);
    return shape(segments, `whisper (${opts.key.backend})`);
  } catch (err) {
    note(`whisper failed: ${err.message}`);
    return shape([], null);
  }
}

/**
 * Print what the agent acts on: the frame paths to Read, the transcript, and
 * the report to fill.
 * @param {object} r A `run` result.
 */
export function renderRun(r) {
  say();
  say("# watch");
  say();
  say(`- **Source:** ${r.src.info?.url || r.src.videoPath}`);
  if (r.src.info?.title) say(`- **Title:** ${r.src.info.title}`);
  if (r.src.info?.uploader) say(`- **Uploader:** ${r.src.info.uploader}`);
  say(`- **Duration:** ${formatTime(r.meta.durationSeconds)}`);
  if (r.focused) say(`- **Range:** ${formatTime(r.rangeStart)} → ${formatTime(r.rangeEnd)}`);
  if (r.meta.width) say(`- **Video:** ${r.meta.width}×${r.meta.height} ${r.meta.codec || ""}`.trim());
  say(`- **Frames:** ${r.frames.length} · ${r.sampling} · ${r.resolution}px wide`);
  if (r.pacing.shotCount) say(`- **Pacing:** ${r.pacing.shotCount} shots · ${r.pacing.cutsPerMinute} cuts/min · mean shot ${r.pacing.meanShotLength}s`);
  say(`- **Transcript:** ${r.transcript.segments.length ? `${r.transcript.segments.length} segments via ${r.transcript.source}` : "none available"}`);

  if (!r.focused && r.meta.durationSeconds > SPARSE_WARNING_SECONDS) {
    say();
    say(`> **Sparse scan.** ${formatTime(r.meta.durationSeconds)} is long for a full pass. If the question is about one part, re-run with \`--start\`/\`--end\` for a dense look at it.`);
  }

  say();
  say("## Frames — Read each path to see the image");
  say();
  for (const f of r.frames) say(`- \`${f.path}\` (t=${formatTime(f.timestampSeconds)})`);
  if (r.hook.ran && r.hook.frames.length) {
    say();
    say("### Hook microscope (0–10s, 2 fps)");
    say();
    for (const f of r.hook.frames) say(`- \`${f.path}\` (t=${formatTime(f.timestampSeconds)})`);
  }

  say();
  say("## Transcript");
  say();
  if (r.transcript.text) {
    say(`_Source: ${r.transcript.source}._`);
    say();
    say("```");
    say(r.transcript.text);
    say("```");
  } else {
    say("_None available — answer from the frames, and say so._");
  }

  say();
  say("---");
  say(`_Report to fill: \`${r.reportPath}\` — then \`watch.mjs stage <projectDir> ${r.workDir}\`._`);
  say(`_Working dir: \`${r.workDir}\` — delete it once the report is staged._`);
}

/**
 * @param {string[]} argv
 * @returns {{ flags: Record<string, string | boolean>, positional: string[] }}
 */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq >= 0) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[arg.slice(2)] = argv[++i];
    else flags[arg.slice(2)] = true;
  }
  return { flags, positional };
}

const USAGE = `usage:
  watch.mjs check
  watch.mjs run   <url-or-path> [--intent "why you're watching"] [--start T] [--end T]
                  [--max-frames N] [--resolution W] [--fps F] [--out-dir DIR]
                  [--whisper groq|openai] [--no-whisper] [--no-scene-change] [--no-hook]
  watch.mjs stage <projectDir> <workDir> [--type entity|pattern|gotcha|glossary|decision]
                  [--page <slug>] [--no-wiki]`;

// ---------- CLI ----------
if (process.argv[1] && basename(process.argv[1]) === "watch.mjs" && process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , cmd, ...rest] = process.argv;
  const die = (msg) => { process.stderr.write(`${msg}\n`); process.exit(1); };
  const { flags, positional } = parseArgs(rest);
  const num = (name) => (flags[name] === undefined ? undefined : Number(flags[name]));

  try {
    if (cmd === "check") {
      process.exit(reportPreflight(preflight()));
    } else if (cmd === "run") {
      if (!positional[0]) die(USAGE);
      const state = preflight();
      if (!state.ready || (isUrl(positional[0]) && state.missing.includes("yt-dlp"))) {
        reportPreflight(state);
        die("watch cannot run until the missing binaries are installed");
      }
      const result = await run({
        source: positional[0],
        intent: typeof flags.intent === "string" ? flags.intent : "",
        outDir: typeof flags["out-dir"] === "string" ? flags["out-dir"] : undefined,
        maxFrames: num("max-frames"),
        resolution: num("resolution"),
        fps: num("fps"),
        start: typeof flags.start === "string" ? flags.start : undefined,
        end: typeof flags.end === "string" ? flags.end : undefined,
        noWhisper: Boolean(flags["no-whisper"]),
        whisper: typeof flags.whisper === "string" ? flags.whisper : undefined,
        noSceneChange: Boolean(flags["no-scene-change"]),
        noHook: Boolean(flags["no-hook"]),
      });
      renderRun(result);
    } else if (cmd === "stage") {
      const [projectDir, workDir] = positional;
      if (!projectDir || !workDir) die(USAGE);
      if (!existsSync(projectDir)) die(`project not found: ${projectDir}`);
      const res = stageWatch({
        projectDir,
        workDir,
        type: typeof flags.type === "string" ? flags.type : undefined,
        page: typeof flags.page === "string" ? flags.page : undefined,
        wiki: !flags["no-wiki"],
      });
      for (const name of res.assets) say(`+ assets/${name}`);
      for (const name of res.skipped) say(`= assets/${name}`);
      if (res.wikiPage) say(`+ ${res.wikiPage} — synthesize it (\`[[FILL]]\`), then \`wiki lint\``);
    } else {
      die(USAGE);
    }
  } catch (err) {
    die(`watch: ${err.message}`);
  }
}
