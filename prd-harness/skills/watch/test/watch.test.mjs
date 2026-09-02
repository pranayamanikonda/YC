import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { which } from "../lib/media.mjs";
import { parseArgs, preflight, run } from "../watch.mjs";

test("flags parse in either spelling, and the source stays positional", () => {
  const { flags, positional } = parseArgs(["clip.mp4", "--intent", "why", "--start=1:30", "--no-whisper", "--max-frames", "40"]);
  assert.deepEqual(positional, ["clip.mp4"]);
  assert.equal(flags.intent, "why");
  assert.equal(flags.start, "1:30");
  assert.equal(flags["no-whisper"], true);
  assert.equal(flags["max-frames"], "40");
});

test("a trailing boolean flag does not swallow the next flag", () => {
  const { flags } = parseArgs(["--no-hook", "--type", "pattern"]);
  assert.equal(flags["no-hook"], true);
  assert.equal(flags.type, "pattern");
});

test("preflight names what is missing and which transcript path is open", () => {
  const state = preflight({ GROQ_API_KEY: "g" });
  assert.equal(state.whisper, "groq");
  assert.deepEqual(preflight({}).whisper, null);
});

test("preflight is not ready when ffmpeg is absent, but a missing yt-dlp only closes URLs", () => {
  const realPath = process.env.PATH;
  try {
    process.env.PATH = "";
    const state = preflight({});
    assert.equal(state.ready, false);
    assert.deepEqual(state.missing.sort(), ["ffmpeg", "ffprobe", "yt-dlp"]);
  } finally {
    process.env.PATH = realPath;
  }
  const withMedia = preflight({});
  if (which("ffmpeg") && which("ffprobe") && !which("yt-dlp")) {
    assert.equal(withMedia.ready, true, "a local file is still watchable without yt-dlp");
  }
});

const hasFfmpeg = Boolean(which("ffmpeg") && which("ffprobe"));

test("a real video is sampled, reported, and left ready to stage", { skip: hasFfmpeg ? false : "ffmpeg not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "watch-e2e-"));
  try {
    const video = join(dir, "clip.mp4");
    const made = spawnSync(which("ffmpeg"), [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=4",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", video,
    ]);
    assert.equal(made.status, 0, "fixture video was not created");

    const result = await run({ source: video, intent: "does the pipeline run", outDir: join(dir, "work"), noWhisper: true, resolution: 160 });

    assert.ok(result.frames.length > 0, "no frames were sampled");
    assert.ok(result.frames.every((f) => existsSync(f.path)), "a listed frame is not on disk");
    assert.ok(result.meta.durationSeconds > 3 && result.meta.durationSeconds < 5);
    assert.equal(result.hook.ran, false, "a 4s video is all hook — the microscope adds nothing");
    assert.equal(result.transcript.segments.length, 0);

    const report = readFileSync(result.reportPath, "utf8");
    assert.match(report, /^title: clip$/m);
    assert.match(report, /^source: clip\.mp4$/m, "the artefact records the filename, not the host path");
    assert.ok(!report.includes(dir), "an absolute working path leaked into the report");
    assert.match(report, /\[\[FILL\]\]/, "the report is left to be synthesized");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a nonsense budget is refused before any work starts", async () => {
  await assert.rejects(run({ source: "clip.mp4", maxFrames: 0 }), /--max-frames must be at least 1/);
  await assert.rejects(run({ source: "clip.mp4", fps: 0 }), /--fps must be greater than 0/);
  await assert.rejects(run({ source: "clip.mp4", resolution: 8 }), /--resolution must be at least 64/);
});

test("a range past the end of the video is refused", { skip: hasFfmpeg ? false : "ffmpeg not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "watch-e2e-"));
  try {
    const video = join(dir, "clip.mp4");
    spawnSync(which("ffmpeg"), [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=4",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", video,
    ]);
    await assert.rejects(run({ source: video, outDir: join(dir, "w1"), noWhisper: true, start: "0:30" }), /past the end of the video/);
    await assert.rejects(run({ source: video, outDir: join(dir, "w2"), noWhisper: true, start: "3", end: "2" }), /--end must be greater/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
