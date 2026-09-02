# Credits — `watch`

This skill is a port. The pipeline it implements — yt-dlp download, ffmpeg frame extraction
at a duration-scaled budget, the Groq/OpenAI Whisper backends, scene-change sampling, the
0–10s hook microscope, and the fixed-schema report with fill markers — comes from two MIT
projects, and the design decisions inside it are theirs.

## Upstream

- **[`bradautomates/claude-video`](https://github.com/bradautomates/claude-video)** — Bradley
  Bonanno. The original `/watch`: the download → frames → transcript pipeline, the duration-
  scaled frame budget, the Whisper backends, and the focused `--start`/`--end` mode.
- **[`taoufik123-collab/claude-watch`](https://github.com/taoufik123-collab/claude-watch)** —
  Taoufik. Scene-change frame extraction, editorial pacing metrics, the hook microscope, hero
  frame selection, and the structured report, on top of Bradley's pipeline.

Both are released under the MIT License. © 2026 Bradley Bonanno.

## What this port changed, and why

- **Python → dependency-free Node**, matching the rest of the harness, so `npm test` covers it.
- **The Obsidian half is gone.** Upstream stages the report into an Obsidian vault and runs
  that vault's ingest op. The harness already has the same idea in its own terms, so `stage`
  targets `<project>/assets/watched/<slug>/` through `assets-intake` (content-hashed,
  manifest-indexed, ledgered) and hands the report to `wiki ingest` as a provenance-carrying
  source. One durability story, not two.
- **`[[FILL]]` replaces `<!-- pending Claude fill: … -->`.** It is the harness's own sentinel,
  so `wiki lint` blocks a gate on an unsynthesized page and `stage` refuses an unsynthesized
  report — the discipline upstream asks for in prose is enforced here.
- **No setup wizard, no written `.env`.** Keys are read from the environment (and from an
  existing `~/.config/watch/.env` if the human already configured the upstream skill), never
  written; `watch.mjs check` prints install commands rather than running a package manager.
- **Artefacts carry no host paths.** The report records the filename and workdir-relative
  frame paths; absolute paths appear only in the terminal output.
