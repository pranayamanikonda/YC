import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKENDS, loadApiKey, transcribeAudio } from "../lib/whisper.mjs";

const ENV_ONLY = [];

/**
 * @param {Array<{ status?: number, body?: any, headers?: Record<string, string> }>} responses
 * @returns {{ fetchImpl: typeof fetch, calls: Array<{ url: string, auth: string, fields: Record<string, any> }> }}
 */
function stubFetch(responses) {
  const calls = [];
  let i = 0;
  const fetchImpl = async (url, init) => {
    const fields = {};
    for (const [k, v] of init.body.entries()) fields[k] = typeof v === "string" ? v : "<file>";
    calls.push({ url, auth: init.headers.Authorization, fields });
    const spec = responses[Math.min(i++, responses.length - 1)];
    const status = spec.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => (spec.headers || {})[name.toLowerCase()] ?? null },
      text: async () => (typeof spec.body === "string" ? spec.body : JSON.stringify(spec.body ?? {})),
    };
  };
  return { fetchImpl, calls };
}

/** @returns {{ dir: string, audioPath: string }} */
function audioFixture() {
  const dir = mkdtempSync(join(tmpdir(), "watch-whisper-"));
  const audioPath = join(dir, "audio.mp3");
  writeFileSync(audioPath, "ID3-AUDIO-BYTES");
  return { dir, audioPath };
}

test("Groq is preferred when both keys are present", () => {
  assert.deepEqual(loadApiKey(null, { GROQ_API_KEY: "g", OPENAI_API_KEY: "o" }, ENV_ONLY), { backend: "groq", apiKey: "g" });
});

test("OpenAI is used when it is the only key", () => {
  assert.deepEqual(loadApiKey(null, { OPENAI_API_KEY: "o" }, ENV_ONLY), { backend: "openai", apiKey: "o" });
});

test("forcing a backend ignores the other key rather than silently substituting", () => {
  assert.deepEqual(loadApiKey("openai", { GROQ_API_KEY: "g" }, ENV_ONLY), { backend: null, apiKey: null });
  assert.throws(() => loadApiKey("deepgram", {}, ENV_ONLY), /unknown whisper backend/);
});

test("no key is a clean null, not a throw", () => {
  assert.deepEqual(loadApiKey(null, {}, ENV_ONLY), { backend: null, apiKey: null });
});

test("a transcription posts the model, the key, and the audio to the right endpoint", async () => {
  const { dir, audioPath } = audioFixture();
  try {
    const { fetchImpl, calls } = stubFetch([{ body: { segments: [{ start: 0, end: 1, text: "hello" }] } }]);
    const res = await transcribeAudio({ audioPath, backend: "groq", apiKey: "secret", fetchImpl });
    assert.deepEqual(res.segments, [{ start: 0, end: 1, text: "hello" }]);
    assert.equal(res.audioBytes, "ID3-AUDIO-BYTES".length);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, BACKENDS.groq.endpoint);
    assert.equal(calls[0].auth, "Bearer secret");
    assert.equal(calls[0].fields.model, BACKENDS.groq.model);
    assert.equal(calls[0].fields.response_format, "verbose_json");
    assert.equal(calls[0].fields["timestamp_granularities[]"], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the hook microscope asks for word-level timestamps", async () => {
  const { dir, audioPath } = audioFixture();
  try {
    const { fetchImpl, calls } = stubFetch([{ body: { words: [{ word: "Stop", start: 0.2, end: 0.4 }] } }]);
    const res = await transcribeAudio({ audioPath, backend: "openai", apiKey: "k", wordTimestamps: true, fetchImpl });
    assert.deepEqual(res.words, [{ word: "Stop", start: 0.2, end: 0.4 }]);
    assert.equal(calls[0].fields["timestamp_granularities[]"], "word");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a bad key fails immediately — no retry will fix a 401", async () => {
  const { dir, audioPath } = audioFixture();
  try {
    const { fetchImpl, calls } = stubFetch([{ status: 401, body: "invalid api key" }]);
    await assert.rejects(transcribeAudio({ audioPath, backend: "groq", apiKey: "bad", fetchImpl }), /HTTP 401/);
    assert.equal(calls.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a rate limit is retried, and the retry's success is returned", async () => {
  const { dir, audioPath } = audioFixture();
  try {
    const { fetchImpl, calls } = stubFetch([
      { status: 429, headers: { "retry-after": "0.01" }, body: "slow down" },
      { body: { segments: [{ start: 0, end: 1, text: "after the wait" }] } },
    ]);
    const warnings = [];
    const res = await transcribeAudio({ audioPath, backend: "groq", apiKey: "k", fetchImpl, warn: (m) => warnings.push(m) });
    assert.equal(res.segments[0].text, "after the wait");
    assert.equal(calls.length, 2);
    assert.match(warnings[0], /HTTP 429/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retries are bounded, and the last error is reported", async () => {
  const { dir, audioPath } = audioFixture();
  try {
    const { fetchImpl, calls } = stubFetch([{ status: 503, headers: { "retry-after": "0.01" }, body: "unavailable" }]);
    await assert.rejects(transcribeAudio({ audioPath, backend: "groq", apiKey: "k", fetchImpl, warn: () => {} }),
      /after 4 attempts.*HTTP 503/s);
    assert.equal(calls.length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a non-JSON body is reported as such rather than parsed into nonsense", async () => {
  const { dir, audioPath } = audioFixture();
  try {
    const { fetchImpl } = stubFetch([{ body: "<html>gateway</html>" }]);
    await assert.rejects(transcribeAudio({ audioPath, backend: "groq", apiKey: "k", fetchImpl }), /non-JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
