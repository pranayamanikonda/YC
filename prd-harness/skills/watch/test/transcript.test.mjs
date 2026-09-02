import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dedupe, filterRange, formatTranscript, parseVttText, segmentsFromWhisper, wordsFromWhisper,
} from "../lib/transcript.mjs";

const VTT = `WEBVTT

00:00:01.000 --> 00:00:03.500
Hello <c.colorE5E5E5>there</c>

00:00:03.500 --> 00:00:06.000
Hello there

00:00:06.000 --> 00:00:09.000
Hello there world

00:00:12.000 --> 00:00:14.000
A second thought
`;

test("VTT cues become timestamped segments with markup stripped", () => {
  const segments = parseVttText(VTT);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0], { start: 1, end: 9, text: "Hello there world" });
  assert.deepEqual(segments[1], { start: 12, end: 14, text: "A second thought" });
});

test("rolling auto-caption duplicates collapse into one segment", () => {
  const rolled = dedupe([
    { start: 0, end: 1, text: "one" },
    { start: 1, end: 2, text: "one" },
    { start: 2, end: 3, text: "one two" },
    { start: 3, end: 4, text: "three" },
  ]);
  assert.deepEqual(rolled, [
    { start: 0, end: 3, text: "one two" },
    { start: 3, end: 4, text: "three" },
  ]);
});

test("SRT-style comma timestamps parse too", () => {
  const segments = parseVttText("1\n00:00:02,000 --> 00:00:04,000\nsubtitle line\n");
  assert.deepEqual(segments, [{ start: 2, end: 4, text: "subtitle line" }]);
});

test("a file with no cues yields no segments rather than throwing", () => {
  assert.deepEqual(parseVttText("WEBVTT\n\nNOTE nothing here\n"), []);
});

test("range filtering keeps every segment that overlaps the window", () => {
  const segments = [
    { start: 0, end: 5, text: "before" },
    { start: 8, end: 12, text: "straddles the start" },
    { start: 13, end: 15, text: "inside" },
    { start: 30, end: 35, text: "after" },
  ];
  assert.deepEqual(filterRange(segments, 10, 20).map((s) => s.text), ["straddles the start", "inside"]);
  assert.equal(filterRange(segments, null, null).length, 4);
  assert.deepEqual(filterRange(segments, 20, null).map((s) => s.text), ["after"]);
});

test("transcripts render as [MM:SS] lines", () => {
  assert.equal(formatTranscript([{ start: 65, text: "a line" }]), "[01:05] a line");
});

test("Whisper verbose_json maps onto the caption segment shape", () => {
  const segments = segmentsFromWhisper({
    segments: [
      { start: 0.123, end: 2.456, text: "  first  " },
      { start: 2.5, end: 4, text: "" },
    ],
  });
  assert.deepEqual(segments, [{ start: 0.12, end: 2.46, text: "first" }]);
});

test("a Whisper response with only flat text still yields one segment", () => {
  assert.deepEqual(segmentsFromWhisper({ text: "no segmentation" }), [{ start: 0, end: 0, text: "no segmentation" }]);
  assert.deepEqual(segmentsFromWhisper({}), []);
});

test("word timestamps carry through for the hook microscope", () => {
  assert.deepEqual(wordsFromWhisper({ words: [{ word: " Stop ", start: 0.2001, end: 0.5 }, { word: "" }] }),
    [{ word: "Stop", start: 0.2, end: 0.5 }]);
});
