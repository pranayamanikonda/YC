#!/bin/sh
# Concatenates src/ into the single self-contained probe.html.
# No dependencies, no bundler — run: sh build.sh
set -e
cd "$(dirname "$0")"
{
  cat src/00-head.html
  echo '<style>'
  cat src/10-styles.css
  echo '</style>'
  cat src/70-body.html
  echo '<script>'
  cat src/20-prompts.js
  cat src/30-recorded.js
  cat src/40-app.js
  cat src/50-view.js
  cat src/60-events.js
  echo '</script>'
} > probe.html
echo "built probe.html ($(wc -c < probe.html) bytes)"
