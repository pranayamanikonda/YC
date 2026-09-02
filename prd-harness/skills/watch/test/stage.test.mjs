import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold } from "../../prd-intake/scaffold.mjs";
import { lint } from "../../wiki/wiki.mjs";
import { renderReport } from "../lib/report.mjs";
import { readReportMeta, stageWatch } from "../lib/stage.mjs";

const DATE = "2026-09-02";
const PRD = "# Watch Demo\n\n## Requirements\n1. one screen\n";

const REPORT = {
  source: "https://example.com/v",
  title: "How Editors Cut",
  durationSeconds: 200,
  intent: "pacing",
  transcriptSegments: [{ start: 1, text: "a line" }],
  transcriptSource: "captions",
  frames: [
    { timestampSeconds: 0, path: "/w/frames/frame_0001.jpg", rel: "frames/frame_0001.jpg" },
    { timestampSeconds: 9, path: "/w/frames/frame_0002.jpg", rel: "frames/frame_0002.jpg" },
  ],
  heroFrames: [{ timestampSeconds: 0, path: "/w/frames/frame_0001.jpg" }],
  pacing: { shotCount: 2, cutsPerMinute: 0.6, meanShotLength: 100, medianShotLength: 100, shots: [] },
  hook: { ran: false, skippedReason: "test" },
  watchedAt: "2026-09-02T10:00:00.000Z",
};

/**
 * A project plus a working directory holding a report and its frames.
 * @param {{ filled?: boolean }} [opts]
 */
function fixture(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "watch-stage-"));
  const { projectDir } = scaffold({ prdText: PRD, outDir: join(root, "out"), date: DATE });
  const workDir = join(root, "work");
  mkdirSync(join(workDir, "frames"), { recursive: true });
  mkdirSync(join(workDir, "hook_frames"), { recursive: true });
  writeFileSync(join(workDir, "frames", "frame_0001.jpg"), "HERO-BYTES");
  writeFileSync(join(workDir, "frames", "frame_0002.jpg"), "OTHER-BYTES");
  // Same name, different content: the hook pass numbers its own frames from 1.
  writeFileSync(join(workDir, "hook_frames", "frame_0001.jpg"), "HOOK-BYTES");
  let md = renderReport(REPORT);
  if (opts.filled !== false) md = md.replace(/\[\[FILL\]\] — [^\n]*/g, "synthesized.");
  writeFileSync(join(workDir, "report.md"), md);
  return { root, projectDir, workDir };
}

test("staging copies the report and its hero frames into the project's assets", () => {
  const { root, projectDir, workDir } = fixture();
  try {
    const res = stageWatch({ projectDir, workDir, date: DATE });
    assert.equal(res.slug, "how-editors-cut-2026-09-02");
    assert.equal(res.reportPath, "assets/watched/how-editors-cut-2026-09-02/report.md");
    assert.ok(existsSync(join(projectDir, res.reportPath)));
    assert.ok(existsSync(join(projectDir, "assets/watched/how-editors-cut-2026-09-02/frame_0001.jpg")));
    assert.ok(!existsSync(join(projectDir, "assets/watched/how-editors-cut-2026-09-02/frame_0002.jpg")),
      "only the hero frames are durable; the rest stay in the working directory");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the hero frame comes from frames/, not the hook pass's like-named file", () => {
  const { root, projectDir, workDir } = fixture();
  try {
    stageWatch({ projectDir, workDir, date: DATE });
    const staged = readFileSync(join(projectDir, "assets/watched/how-editors-cut-2026-09-02/frame_0001.jpg"), "utf8");
    assert.equal(staged, "HERO-BYTES");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("staged files are content-hashed into the manifest and the ledger", () => {
  const { root, projectDir, workDir } = fixture();
  try {
    stageWatch({ projectDir, workDir, date: DATE });
    const manifest = JSON.parse(readFileSync(join(projectDir, ".harness/manifest.json"), "utf8"));
    assert.equal(manifest.assets.length, 2);
    for (const asset of manifest.assets) {
      assert.match(asset.name, /^watched\/how-editors-cut-2026-09-02\//);
      assert.match(asset.sha256, /^[0-9a-f]{64}$/);
    }
    const ledger = readFileSync(join(projectDir, ".harness/ledger/watch-demo.md"), "utf8");
    assert.match(ledger, /assets ingested: \[watched\/how-editors-cut-2026-09-02\/report\.md/);
    assert.match(ledger, /wiki ingest: wiki\/entities\/how-editors-cut-2026-09-02\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the wiki page cites the staged report with its hash, and lint holds it until synthesized", () => {
  const { root, projectDir, workDir } = fixture();
  try {
    const res = stageWatch({ projectDir, workDir, type: "pattern", date: DATE });
    assert.equal(res.wikiPage, "wiki/patterns/how-editors-cut-2026-09-02.md");
    const page = readFileSync(join(projectDir, res.wikiPage), "utf8");
    assert.match(page, /path: assets\/watched\/how-editors-cut-2026-09-02\/report\.md {2}hash: [0-9a-f]{64}/);
    const issues = lint(projectDir);
    assert.ok(issues.some((i) => i.sev === "error" && /not yet synthesized/.test(i.msg)),
      "an unsynthesized page must block the gate");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--no-wiki stages the assets without scaffolding a page", () => {
  const { root, projectDir, workDir } = fixture();
  try {
    const res = stageWatch({ projectDir, workDir, wiki: false, date: DATE });
    assert.equal(res.wikiPage, null);
    assert.ok(existsSync(join(projectDir, res.reportPath)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unsynthesized report is refused — half-filled reports make empty wiki pages", () => {
  const { root, projectDir, workDir } = fixture({ filled: false });
  try {
    assert.throws(() => stageWatch({ projectDir, workDir, date: DATE }), /6 unfilled \[\[FILL\]\] markers/);
    assert.ok(!existsSync(join(projectDir, "assets/watched")), "nothing is staged when the report is refused");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("staging the same watch twice is idempotent", () => {
  const { root, projectDir, workDir } = fixture();
  try {
    stageWatch({ projectDir, workDir, date: DATE });
    const again = stageWatch({ projectDir, workDir, date: DATE });
    assert.equal(again.assets.length, 0);
    assert.equal(again.skipped.length, 2);
    assert.equal(again.reportPath, "assets/watched/how-editors-cut-2026-09-02/report.md");
    const manifest = JSON.parse(readFileSync(join(projectDir, ".harness/manifest.json"), "utf8"));
    assert.equal(manifest.assets.length, 2, "re-staging does not duplicate assets");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing report names the command that produces one", () => {
  const { root, projectDir } = fixture();
  try {
    assert.throws(() => stageWatch({ projectDir, workDir: join(root, "nowhere"), date: DATE }), /no report\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readReportMeta parses the hero frame list back out of the frontmatter", () => {
  const { root, workDir } = fixture();
  try {
    const { frontmatter, heroFrames } = readReportMeta(join(workDir, "report.md"));
    assert.equal(frontmatter.title, "How Editors Cut");
    assert.deepEqual(heroFrames, ["frame_0001.jpg"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
