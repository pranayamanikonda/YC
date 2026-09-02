import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pendingFills, renderReport, writeReport } from "../lib/report.mjs";
import { parsePage } from "../../wiki/wiki.mjs";

const BASE = {
  source: "https://example.com/v",
  title: "A Video",
  durationSeconds: 125,
  intent: "how the hook works",
  transcriptSegments: [{ start: 3, text: "the opening line" }],
  transcriptSource: "captions",
  frames: [
    { timestampSeconds: 0, path: "/work/frames/frame_0001.jpg", rel: "frames/frame_0001.jpg" },
    { timestampSeconds: 30, path: "/work/frames/frame_0002.jpg", rel: "frames/frame_0002.jpg" },
  ],
  heroFrames: [{ timestampSeconds: 0, path: "/work/frames/frame_0001.jpg" }],
  pacing: { shotCount: 2, cutsPerMinute: 0.96, meanShotLength: 62.5, medianShotLength: 62.5, shots: [] },
  hook: { ran: true, frames: [{}, {}], words: [{ word: "Stop", start: 0.2 }] },
  watchedAt: "2026-09-02T10:00:00.000Z",
};

test("the report's frontmatter is what staging reads back", () => {
  const { frontmatter } = parsePage(renderReport(BASE));
  assert.equal(frontmatter.title, "A Video");
  assert.equal(frontmatter.duration, "02:05");
  assert.equal(frontmatter.intent, "how the hook works");
  assert.equal(frontmatter.hero_frames, "[frame_0001.jpg]");
  assert.equal(frontmatter.transcript_source, "captions");
});

test("every judgement section is left as a [[FILL]] marker with its brief", () => {
  const md = renderReport(BASE);
  assert.equal(pendingFills(md, { isText: true }), 7);
  for (const heading of ["## TL;DR", "## Key moments", "## Editorial profile", "## Quotable moments", "## Entities", "## Concepts"]) {
    assert.ok(md.includes(heading), `missing ${heading}`);
  }
  assert.match(md, /\[\[FILL\]\] — 3-5 bullets through the lens of: "how the hook works"/);
});

test("the intent is the lens, and its absence is stated rather than faked", () => {
  const md = renderReport({ ...BASE, intent: "" });
  assert.match(md, /^intent: \(none given\)$/m);
  assert.match(md, /lens of: "general summary"/);
});

test("measured facts are written, not left for the agent", () => {
  const md = renderReport(BASE);
  assert.match(md, /- Cuts\/min: 0\.96/);
  assert.match(md, /\[00:03\] the opening line/);
  assert.match(md, /\[ {2}0\.20s\] Stop/);
});

test("frames are recorded workdir-relative, never as host paths", () => {
  const md = renderReport(BASE);
  assert.ok(!md.includes("/work/frames/"), "an absolute working path leaked into the artefact");
  assert.match(md, /\* `frames\/frame_0001\.jpg` \(t=00:00\)/);
  assert.match(md, /^ {2}`frames\/frame_0002\.jpg` \(t=00:30\)$/m);
});

test("a skipped hook and an absent transcript say so", () => {
  const md = renderReport({ ...BASE, hook: { ran: false, skippedReason: "video under 30s" }, transcriptSegments: [], transcriptSource: null });
  assert.match(md, /_Skipped: video under 30s\._/);
  assert.match(md, /_No transcript available\._/);
  assert.equal(pendingFills(md, { isText: true }), 6, "the hook's fill marker is dropped when the hook did not run");
});

test("a static source reports no pacing instead of zeroes", () => {
  const md = renderReport({ ...BASE, pacing: { shotCount: 0, shots: [] } });
  assert.match(md, /_No scene-change data — a static or screen-recorded source\._/);
});

test("writeReport creates the file and pendingFills reads it back", () => {
  const dir = mkdtempSync(join(tmpdir(), "watch-report-"));
  try {
    const path = writeReport(join(dir, "nested", "report.md"), BASE);
    assert.equal(pendingFills(path), 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
