/**
 * Timestamped transcripts, from either source — native captions (free) or
 * Whisper (paid fallback) — normalized to one segment shape so nothing
 * downstream cares which it got.
 *
 * Segment: `{ start, end, text }`, seconds.
 */

import { readFileSync } from "node:fs";
import { formatTime } from "./timeline.mjs";

const CUE_RE = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/;
const TAG_RE = /<[^>]+>/g;

/**
 * @param {string} h @param {string} m @param {string} s @param {string} ms
 * @returns {number} seconds.
 */
function toSeconds(h, m, s, ms) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

/**
 * Parse WebVTT (or SRT-style timing) into segments.
 * @param {string} text File contents.
 * @returns {Array<{ start: number, end: number, text: string }>}
 */
export function parseVttText(text) {
  const lines = String(text).split(/\r?\n/);
  const segments = [];
  for (let i = 0; i < lines.length; i++) {
    const match = CUE_RE.exec(lines[i]);
    if (!match) continue;
    const start = toSeconds(match[1], match[2], match[3], match[4]);
    const end = toSeconds(match[5], match[6], match[7], match[8]);
    const cue = [];
    for (i++; i < lines.length && lines[i].trim(); i++) {
      const cleaned = lines[i].replace(TAG_RE, "").trim();
      if (cleaned) cue.push(cleaned);
    }
    const joined = cue.join(" ").trim();
    if (joined) segments.push({ start: round2(start), end: round2(end), text: joined });
  }
  return dedupe(segments);
}

/**
 * @param {string} path
 * @returns {Array<{ start: number, end: number, text: string }>}
 */
export function parseVtt(path) {
  return parseVttText(readFileSync(path, "utf8"));
}

/**
 * Collapse the rolling duplicates YouTube auto-captions emit — each line
 * reappears two or three times as it scrolls up the screen.
 * @param {Array<{ start: number, end: number, text: string }>} segments
 * @returns {Array<{ start: number, end: number, text: string }>}
 */
export function dedupe(segments) {
  const out = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && seg.text === last.text) {
      last.end = seg.end;
      continue;
    }
    if (last && seg.text.startsWith(`${last.text} `)) {
      last.text = seg.text;
      last.end = seg.end;
      continue;
    }
    out.push({ ...seg });
  }
  return out;
}

/**
 * Keep the segments overlapping [start, end].
 * @param {Array<{ start: number, end: number, text: string }>} segments
 * @param {number | null} startSeconds
 * @param {number | null} endSeconds
 * @returns {Array<{ start: number, end: number, text: string }>}
 */
export function filterRange(segments, startSeconds, endSeconds) {
  if (startSeconds === null && endSeconds === null) return segments;
  const lo = startSeconds ?? -Infinity;
  const hi = endSeconds ?? Infinity;
  return segments.filter((s) => s.end >= lo && s.start <= hi);
}

/**
 * @param {Array<{ start: number, text: string }>} segments
 * @returns {string} `[MM:SS] text` lines.
 */
export function formatTranscript(segments) {
  return segments.map((s) => `[${formatTime(s.start)}] ${s.text}`).join("\n");
}

/**
 * Whisper's `verbose_json` → our segment shape.
 * @param {any} data
 * @returns {Array<{ start: number, end: number, text: string }>}
 */
export function segmentsFromWhisper(data) {
  const out = [];
  for (const seg of data?.segments || []) {
    const text = String(seg.text || "").trim();
    if (text) out.push({ start: round2(Number(seg.start) || 0), end: round2(Number(seg.end) || 0), text });
  }
  if (!out.length && String(data?.text || "").trim()) {
    out.push({ start: 0, end: 0, text: String(data.text).trim() });
  }
  return out;
}

/**
 * Whisper's word-level timestamps → `{ word, start, end }`.
 * @param {any} data
 * @returns {Array<{ word: string, start: number, end: number }>}
 */
export function wordsFromWhisper(data) {
  const out = [];
  for (const w of data?.words || []) {
    const word = String(w.word || "").trim();
    if (word) out.push({ word, start: round3(Number(w.start) || 0), end: round3(Number(w.end) || 0) });
  }
  return out;
}

/** @param {number} n @returns {number} */
function round2(n) {
  return Math.round(n * 100) / 100;
}
/** @param {number} n @returns {number} */
function round3(n) {
  return Math.round(n * 1000) / 1000;
}
