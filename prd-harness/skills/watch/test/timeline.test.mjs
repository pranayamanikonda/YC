import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FPS, autoFps, autoFpsFocus, computePacing, formatTime, parseTime, selectHeroFrames,
} from "../lib/timeline.mjs";

test("parseTime accepts SS, MM:SS and HH:MM:SS", () => {
  assert.equal(parseTime("45"), 45);
  assert.equal(parseTime("2:15"), 135);
  assert.equal(parseTime("1:02:03"), 3723);
  assert.equal(parseTime("0:00:01.5"), 1.5);
  assert.equal(parseTime(90), 90);
  assert.equal(parseTime(null), null);
  assert.equal(parseTime(""), null);
});

test("parseTime rejects garbage rather than guessing", () => {
  assert.throws(() => parseTime("soon"), /cannot parse time/);
  assert.throws(() => parseTime("1:2:3:4"), /cannot parse time/);
  assert.throws(() => parseTime("::"), /cannot parse time/);
});

test("formatTime drops the hour until there is one", () => {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(65), "01:05");
  assert.equal(formatTime(3723), "1:02:03");
});

test("the full-video budget stays inside the frame cap at every length", () => {
  for (const duration of [5, 29, 30, 59, 60, 179, 180, 599, 600, 1800, 7200]) {
    const { fps, target } = autoFps(duration);
    assert.ok(fps <= MAX_FPS, `${duration}s: fps ${fps} over the ceiling`);
    assert.ok(target > 0 && target <= 100, `${duration}s: target ${target} outside 1..100`);
  }
});

test("a long video is capped, a short one stays dense", () => {
  assert.equal(autoFps(3600).target, 100);
  assert.ok(autoFps(20).fps > autoFps(3600).fps);
  assert.equal(autoFps(0).target, 1);
});

test("--max-frames lowers the budget", () => {
  assert.equal(autoFps(600, 40).target, 40);
  assert.equal(autoFpsFocus(20, 25).target, 25);
});

test("a named range is sampled denser than the same span of a full scan", () => {
  assert.ok(autoFpsFocus(30).fps > autoFps(30).fps);
  assert.ok(autoFpsFocus(3).fps <= MAX_FPS);
});

test("pacing turns shot starts into cuts/min and shot lengths", () => {
  const pacing = computePacing([0, 10, 20], 60);
  assert.equal(pacing.shotCount, 3);
  assert.equal(pacing.cutsPerMinute, 3);
  assert.equal(pacing.meanShotLength, 20);
  assert.equal(pacing.medianShotLength, 10);
  assert.deepEqual(pacing.shots.at(-1), { startSeconds: 20, durationSeconds: 40 });
});

test("pacing implies a shot 0 when the first cut is not at the start", () => {
  const pacing = computePacing([5, 15], 20);
  assert.equal(pacing.shotCount, 3);
  assert.equal(pacing.shots[0].startSeconds, 0);
  assert.equal(pacing.shots[0].durationSeconds, 5);
});

test("pacing is empty rather than NaN with no scene data", () => {
  assert.deepEqual(computePacing([], 60).shots, []);
  assert.equal(computePacing([0, 5], 0).shotCount, 0);
});

const frames = Array.from({ length: 12 }, (_, i) => ({ timestampSeconds: i * 5, path: `/w/frame_${i}.jpg` }));

test("hero selection keeps the opening shot and the longest one", () => {
  const pacing = computePacing([0, 5, 10, 40], 60);
  const heroes = selectHeroFrames(frames, pacing);
  assert.ok(heroes.length >= 3 && heroes.length <= 5);
  assert.equal(heroes[0].timestampSeconds, 0, "the opening frame is always a hero");
  assert.ok(heroes.some((f) => f.timestampSeconds === 40), "the longest shot's first frame is a hero");
});

test("hero selection falls back to even spacing without pacing data", () => {
  const heroes = selectHeroFrames(frames, { shots: [] });
  assert.equal(heroes.length, 5);
  assert.deepEqual([...new Set(heroes.map((f) => f.path))].length, 5);
  assert.deepEqual(heroes.map((f) => f.timestampSeconds), [...heroes.map((f) => f.timestampSeconds)].sort((a, b) => a - b));
});

test("hero selection handles an empty or tiny frame set", () => {
  assert.deepEqual(selectHeroFrames([], null), []);
  assert.equal(selectHeroFrames(frames.slice(0, 2), null).length, 2);
});
