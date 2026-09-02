/**
 * Whisper transcription — the paid fallback for when a video has no captions.
 *
 * Only the extracted audio ever leaves the machine, never the video. Keys come
 * from the environment (or a pre-existing `~/.config/watch/.env`, read-only);
 * this skill never writes a key anywhere, and never prints one.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Blob } from "node:buffer";
import { segmentsFromWhisper, wordsFromWhisper } from "./transcript.mjs";

/** Backend → endpoint, model, and the env var carrying its key. Groq first: cheaper and faster. */
export const BACKENDS = {
  groq: { endpoint: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3", envVar: "GROQ_API_KEY" },
  openai: { endpoint: "https://api.openai.com/v1/audio/transcriptions", model: "whisper-1", envVar: "OPENAI_API_KEY" },
};

/** Where a key may already live if the human configured the upstream skill. Read-only. */
const DEFAULT_DOTENV_PATHS = () => [join(homedir(), ".config", "watch", ".env"), join(process.cwd(), ".env")];

const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 2000;
const REQUEST_TIMEOUT_MS = 300_000;

/**
 * Read one key from a dotenv-style file. The file is only ever read — the skill
 * does not create or modify it.
 * @param {string} path
 * @param {string} name
 * @returns {string | null}
 */
function fromDotenv(path, name) {
  if (!existsSync(path)) return null;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0 || trimmed.slice(0, eq).trim() !== name) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
      value = value.slice(1, -1);
    }
    return value || null;
  }
  return null;
}

/**
 * Resolve which Whisper backend is usable.
 * @param {"groq" | "openai" | null} [preferred] Restrict to one backend.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string[]} [dotenvPaths] Files to fall back to; pass `[]` for env-only.
 * @returns {{ backend: "groq" | "openai", apiKey: string } | { backend: null, apiKey: null }}
 */
export function loadApiKey(preferred = null, env = process.env, dotenvPaths = DEFAULT_DOTENV_PATHS()) {
  const order = preferred ? [preferred] : ["groq", "openai"];
  for (const backend of order) {
    const spec = BACKENDS[backend];
    if (!spec) throw new Error(`unknown whisper backend: ${backend}`);
    let value = (env[spec.envVar] || "").trim();
    for (const path of dotenvPaths) {
      if (value) break;
      value = (fromDotenv(path, spec.envVar) || "").trim();
    }
    if (value) return { backend, apiKey: value };
  }
  return { backend: null, apiKey: null };
}

/** @param {number} ms @returns {Promise<void>} */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST an audio file to a Whisper endpoint, with bounded retries.
 *
 * 4xx other than 429 are client errors no retry can fix, so they fail fast;
 * 429 and 5xx back off. The User-Agent is set because Groq sits behind a WAF
 * that rejects the default one before auth even runs.
 * @param {object} opts
 * @param {"groq" | "openai"} opts.backend
 * @param {string} opts.apiKey
 * @param {string} opts.audioPath
 * @param {boolean} [opts.wordTimestamps]
 * @param {(msg: string) => void} [opts.warn]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<any>} the parsed verbose_json response.
 */
export async function postWhisper(opts) {
  const spec = BACKENDS[opts.backend];
  if (!spec) throw new Error(`unknown whisper backend: ${opts.backend}`);
  const warn = opts.warn || (() => {});
  const doFetch = opts.fetchImpl || fetch;
  const bytes = readFileSync(opts.audioPath);

  let lastError = "unknown error";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const form = new FormData();
    form.append("model", spec.model);
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    if (opts.wordTimestamps) form.append("timestamp_granularities[]", "word");
    form.append("file", new Blob([bytes], { type: "audio/mpeg" }), "audio.mp3");

    let response;
    try {
      response = await doFetch(spec.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "User-Agent": "prd-harness-watch/1.0" },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = `network error (${err.name}: ${err.message})`;
      if (attempt === MAX_ATTEMPTS - 1) break;
      const delay = RETRY_BASE_MS * (attempt + 1);
      warn(`whisper ${lastError} — retrying in ${delay / 1000}s (attempt ${attempt + 2}/${MAX_ATTEMPTS})`);
      await sleep(delay);
      continue;
    }

    if (response.ok) {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (err) {
        throw new Error(`whisper returned non-JSON: ${err.message}: ${text.slice(0, 200)}`);
      }
    }

    const detail = (await response.text().catch(() => "")).slice(0, 400);
    lastError = `HTTP ${response.status}${detail ? ` — ${detail}` : ""}`;
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new Error(`whisper request failed: ${lastError}`);
    }
    if (attempt === MAX_ATTEMPTS - 1) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : RETRY_BASE_MS * 2 ** attempt;
    warn(`whisper ${lastError} — retrying in ${delay / 1000}s (attempt ${attempt + 2}/${MAX_ATTEMPTS})`);
    await sleep(delay);
  }
  throw new Error(`whisper request failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

/**
 * Transcribe an audio file.
 * @param {object} opts
 * @param {string} opts.audioPath
 * @param {"groq" | "openai"} opts.backend
 * @param {string} opts.apiKey
 * @param {boolean} [opts.wordTimestamps]
 * @param {(msg: string) => void} [opts.warn]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{ segments: Array<object>, words: Array<object>, backend: string, audioBytes: number }>}
 */
export async function transcribeAudio(opts) {
  const data = await postWhisper(opts);
  return {
    segments: segmentsFromWhisper(data),
    words: opts.wordTimestamps ? wordsFromWhisper(data) : [],
    backend: opts.backend,
    audioBytes: statSync(opts.audioPath).size,
  };
}
