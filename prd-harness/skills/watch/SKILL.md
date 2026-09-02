---
name: watch
description: Watch a video — a URL or a local file — and answer from what is actually on screen and in the audio. Samples one frame per shot, measures the cutting, microscopes the first ten seconds, and pulls a timestamped transcript. Use whenever a video is the source: a competitor's launch, a screen recording of a bug, a user-research session, a talk the PRD cites.
---

# watch

You have no video input; this gives you one. The engine samples the video into frames you
`Read` as images, measures what can be measured, and writes a report with the judgement
parts left blank. You watch, you answer, you fill the report — then it becomes a project
asset and a wiki source, like any other durable input.

## Run

```bash
node prd-harness/skills/watch/watch.mjs check                    # what's installed, once per machine
node prd-harness/skills/watch/watch.mjs run <url-or-path> --intent "<why you're watching>"
node prd-harness/skills/watch/watch.mjs stage <projectDir> <workDir> [--type <t>]
```

`run` flags: `--start T` / `--end T` (`SS`, `MM:SS`, `HH:MM:SS`) · `--max-frames N` ·
`--resolution W` (512 default; 1024 only to read on-screen text) · `--fps F` ·
`--out-dir DIR` · `--whisper groq|openai` · `--no-whisper` · `--no-scene-change` · `--no-hook`.

## The loop

1. **Separate the source from the question.** The question is the `--intent`, and it is the
   lens the whole report is written through — the same video watched for "pricing tactics"
   and for "editing style" yields different reports. With no question, infer a short one.
2. **Run it.** Name a range with `--start`/`--end` whenever the human named a moment ("around
   2:30", "the last minute") or the video runs past ten minutes — a dense look at the part
   they asked about beats a sparse scan of the whole thing.
3. **Read every frame path it prints**, in one message so you see them together. Each carries
   its `t=MM:SS`, so frames align to the transcript.
4. **Answer, citing timestamps.** You watched it; answer like it. Say plainly when the
   transcript was missing and you are reading from frames alone.
5. **Fill the report.** Every `[[FILL]]` in `<workDir>/report.md` carries its brief. Write
   them all — `stage` refuses a report with any left standing, because an unsynthesized
   report ingests into empty wiki pages.
6. **Stage it into the project.** `stage` copies the report and its hero frames into
   `<project>/assets/watched/<slug>/` (content-hashed, manifest-indexed, ledgered) and
   scaffolds a wiki page citing it. Synthesize that page, then `wiki lint`. Pick `--type` by
   what the video taught: `entity` for a company/product/person, `pattern` for a technique,
   `gotcha` for a failure, `decision` when it settles one.
7. **Delete the working directory.** It holds the video, every frame, and an audio clip —
   none of that belongs in git, and the hero frames are already staged. Keep it only while
   follow-up questions are still coming: re-reading frames you already have costs nothing,
   re-running the video costs everything.

## What the engine decides

- **One frame per shot.** Scene-change sampling, not a tick every N seconds — so frame count
  tracks the number of cuts, not the duration. A static source (screen recording, single-take
  talking head) yields almost no cuts and falls back to uniform sampling automatically.
- **A budget, not a rate.** Frames are images and images are most of the cost: ≤30s gets ~30
  frames, 3–10min gets ~80, longer is capped at 100 and warned about. A named range is
  sampled denser. Nothing exceeds 2 fps or 100 frames.
- **The first ten seconds get a microscope** — 2 fps plus a word-level transcript, so you can
  read each frame against the word landing on it. Skipped under 30s, where the whole scan is
  already that dense.
- **Captions before Whisper.** Native captions are free, already aligned, and usually there.
  Whisper runs only when there are none; without a key the report is frames-only and says so.

## Transcription keys

`GROQ_API_KEY` (preferred — cheaper and faster) or `OPENAI_API_KEY` in the environment. Only
the extracted audio is ever uploaded, never the video, and only when captions are missing.
`--no-whisper` keeps everything local.

## Failure modes

- **A binary is missing** → `watch.mjs check` prints the install command. A missing `yt-dlp`
  closes URLs only; local files still watch.
- **Download refused** (login-required, region-locked, age-gated) → say so plainly and ask
  for a local file. Do not retry.
- **No transcript** → answer from frames and say the audio was unavailable.
- **Sparse-scan warning** → say the coverage is thin, then offer a focused re-run over the
  part that matters.
- **`stage` refuses the report** → fill the remaining `[[FILL]]` markers; the count is in the
  error.

Adapted from [`taoufik123-collab/claude-watch`](https://github.com/taoufik123-collab/claude-watch)
and Bradley Bonanno's original `claude-video` — see [`CREDITS.md`](./CREDITS.md).
