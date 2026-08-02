import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { scaffold } from "../../prd-intake/scaffold.mjs";
import { nextStage, gateBefore, STAGES } from "../lib/model.mjs";
import { runStage, STAGE_SPEC } from "../stage.mjs";
import { status, approve, advance } from "../run.mjs";

const DATE = "2026-08-02";
const PRD = `# Big Product\n\n## Requirements\n1. screen page view service dashboard endpoint\n2. api schema integration migration\n\n## Assumptions to confirm\n- unclear? maybe?\n`;

/** Scaffold a large-tier project and return its dir. */
function newProject() {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-"));
  const res = scaffold({ prdText: PRD, outDir: dir, date: DATE });
  return { root: dir, projectDir: res.projectDir, tier: res.tier };
}

/** Write minimal artefact content that satisfies a stage's markers. */
function fillStage(projectDir, stageId) {
  for (const art of STAGE_SPEC[stageId].artefacts) {
    const full = join(projectDir, art.path);
    mkdirSync(dirname(full), { recursive: true });
    let content;
    switch (art.path) {
      case "definition/acceptance-criteria.md":
        content = "### AC-001\n- Expected: a real observable result\n";
        break;
      case "docs/plans/active/exec-plan.md":
        content = "# Exec Plan\n| id | deps | acceptance | tier | owner |\n| WU-1 | — | AC-001 | small | implementer |\n";
        break;
      case "docs/validation-report.md":
        content = "# Validation Report\nVerdict: READY\n";
        break;
      case "design/design-system/tokens.md":
        content = "# tokens\n## Color\npalette\n## Type\nfont scale\n## Spacing\ngap/padding\n";
        break;
      default:
        // Satisfy the marker; no [[FILL]], no forbidden placeholder.
        content = `# ${art.path}\n\n${art.marker ? art.marker.source.replace(/[\\^$.*+?()[\]{}|]/g, "") : "content"}\n\nReal content here.\n`;
    }
    writeFileSync(full, content);
  }
}

// ---------- model ----------

test("nextStage returns the first unfinished masked stage, skipping intake", () => {
  const mask = ["0-intake", "1-definition", "2-ia"];
  assert.equal(nextStage(mask, { "0-intake": "done" }), "1-definition");
  assert.equal(nextStage(mask, { "0-intake": "done", "1-definition": "done" }), "2-ia");
  assert.equal(nextStage(mask, { "0-intake": "done", "1-definition": "done", "2-ia": "done" }), null);
});

test("gates bind to stage transitions", () => {
  assert.equal(gateBefore("1-definition"), "G1");
  assert.equal(gateBefore("6-engineering"), "G2");
  assert.equal(gateBefore("7-ship"), "G3");
  assert.equal(gateBefore("2-ia"), null);
});

// ---------- gate & sequencing enforcement ----------

test("a project starts blocked at G1 before definition", () => {
  const { root, projectDir } = newProject();
  try {
    const st = status(projectDir);
    assert.equal(st.next, "1-definition");
    assert.equal(st.blockedBy, "G1");
    assert.equal(st.complete, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("advance stops at G1 with nothing run until approved", () => {
  const { root, projectDir } = newProject();
  try {
    const res = advance(projectDir, { date: DATE });
    assert.deepEqual(res.ran, []);
    assert.equal(res.stopped.gate, "G1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runStage refuses a stage whose prior stage is not done", () => {
  const { root, projectDir } = newProject();
  try {
    approve(projectDir, "G1", DATE);
    const res = runStage(projectDir, "2-ia", { date: DATE });
    assert.equal(res.ok, false);
    assert.match(res.reason, /prior stage 1-definition/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- scaffold → fill → advance ----------

test("a stage scaffolds stubs then completes once filled", () => {
  const { root, projectDir } = newProject();
  try {
    approve(projectDir, "G1", DATE);
    // First run: scaffolds design stubs, blocks on unfilled content.
    const first = runStage(projectDir, "1-definition", { date: DATE });
    assert.equal(first.ok, false);
    assert.ok(first.scaffolded.includes("design/principles.md"));
    assert.ok(first.issues.length > 0);
    const stub = readFileSync(join(projectDir, "design/principles.md"), "utf8");
    assert.match(stub, /\[\[FILL\]\]/);
    assert.match(stub, /## Accessibility/); // design stub carries a11y section

    // Agent fills; re-run completes and hands off.
    fillStage(projectDir, "1-definition");
    const second = runStage(projectDir, "1-definition", { date: DATE });
    assert.equal(second.ok, true);
    assert.equal(second.next, "2-ia");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- full end-to-end run through all gates ----------

test("advance drives the whole pipeline to complete across G1/G2/G3", () => {
  const { root, projectDir } = newProject();
  try {
    const runnable = STAGES.filter((s) => STAGE_SPEC[s]);
    approve(projectDir, "G1", DATE);
    approve(projectDir, "G2", DATE);
    approve(projectDir, "G3", DATE);

    // Loop: advance runs stages until it hits an unfilled stage; fill it; repeat.
    let guard = 0;
    while (guard++ < 20) {
      const res = advance(projectDir, { date: DATE });
      const st = res.stopped;
      if (st.reason === "pipeline complete") break;
      if (st.issues) {
        fillStage(projectDir, st.stage);
        continue;
      }
      assert.fail(`unexpected stop: ${JSON.stringify(st)}`);
    }
    const final = status(projectDir);
    assert.equal(final.complete, true);
    for (const s of runnable) assert.equal(final.stages.find((x) => x.stage === s)?.status, "done");

    // The ledger recorded a HANDOFF for every runnable stage.
    const m = JSON.parse(readFileSync(join(projectDir, ".harness/manifest.json"), "utf8"));
    const ledger = readFileSync(join(projectDir, `.harness/ledger/${m.project}.md`), "utf8");
    for (const s of runnable) assert.match(ledger, new RegExp(`HANDOFF from ${s}`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("engineering stays blocked until G2 even when design is done", () => {
  const { root, projectDir } = newProject();
  try {
    approve(projectDir, "G1", DATE);
    // Complete all design stages (2..5) and definition, but NOT G2.
    for (const s of ["1-definition", "2-ia", "3-workflows", "4-wireframes", "5-visual"]) {
      fillStage(projectDir, s);
      runStage(projectDir, s, { date: DATE });
    }
    const res = advance(projectDir, { date: DATE });
    assert.equal(res.stopped.gate, "G2");
    assert.equal(res.stopped.stage, "6-engineering");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
