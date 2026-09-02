import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isUrl, resolveLocal, slugify } from "../lib/source.mjs";
import { parseSceneTimes } from "../lib/media.mjs";

test("a URL is told from a path", () => {
  assert.equal(isUrl("https://youtu.be/abc"), true);
  assert.equal(isUrl("http://example.com/v.mp4"), true);
  assert.equal(isUrl("./clip.mp4"), false);
  assert.equal(isUrl("/abs/clip.mov"), false);
  assert.equal(isUrl("C:\\videos\\clip.mp4"), false);
  assert.equal(isUrl("--start"), false, "a stray flag is never a source");
  assert.equal(isUrl("file:///clip.mp4"), false, "only http(s) goes through yt-dlp");
});

test("a local file resolves without a download", () => {
  const dir = mkdtempSync(join(tmpdir(), "watch-src-"));
  try {
    const path = join(dir, "clip.mp4");
    writeFileSync(path, "video");
    const res = resolveLocal(path);
    assert.equal(res.downloaded, false);
    assert.equal(res.videoPath, path);
    assert.equal(res.subtitlePath, null);
    assert.equal(res.info.title, "clip");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown extension warns but still proceeds", () => {
  const dir = mkdtempSync(join(tmpdir(), "watch-src-"));
  try {
    const path = join(dir, "recording.bin");
    writeFileSync(path, "video");
    const warnings = [];
    const res = resolveLocal(path, (m) => warnings.push(m));
    assert.equal(res.videoPath, path);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /not a known video extension/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing file fails by name", () => {
  assert.throws(() => resolveLocal("/no/such/clip.mp4"), /file not found/);
});

test("slugs are dated, ASCII, and bounded", () => {
  assert.equal(slugify("Karpathy: CLAUDE.md & 43k installs!", "2026-05-24"), "karpathy-claude-md-43k-installs-2026-05-24");
  assert.equal(slugify("Café — Ünicode", "2026-05-24"), "cafe-unicode-2026-05-24");
  assert.equal(slugify("", "2026-05-24"), "video-2026-05-24");
  const long = slugify("x".repeat(200), "2026-05-24");
  assert.equal(long, `${"x".repeat(60)}-2026-05-24`);
});

test("scene timestamps parse from either ffmpeg spelling and either stream", () => {
  const text = "frame:0 pts:0 pts_time:0\nlavfi.scene_score=0.51\nframe:1 pts:90 pts_time=3.75\n";
  assert.deepEqual(parseSceneTimes(text), [0, 3.75]);
  assert.deepEqual(parseSceneTimes("no metadata here"), []);
});
