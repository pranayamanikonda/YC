import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { scaffold } from "../../prd-intake/scaffold.mjs";
import { STAGE_ARTEFACTS } from "../lib/model.mjs";
import { STAGE_SPEC, runStage } from "../stage.mjs";
import { audit, staleStages } from "../audit.mjs";
import { approve, advance, status } from "../run.mjs";

const DATE = "2026-08-02";
const PRD = "# Audit Project\n\n## Requirements\n1. screen page service api schema integration\n2. dashboard endpoint\n\n## Assumptions\n- x? y?\n";

function fresh() {
  const root = mkdtempSync(join(tmpdir(), "audit-"));
  const { projectDir } = scaffold({ prdText: PRD, outDir: root, date: DATE });
  return { root, projectDir };
}

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
        content = "# Exec Plan\n| WU-1 | — | AC-001 | small | implementer |\n";
        break;
      case "docs/validation-report.md":
        content = "# Validation Report\nVerdict: READY\n";
        break;
      case "design/design-system/tokens.md":
        content = "# tokens\n## Color\npalette\n## Type\nfont scale\n## Spacing\ngap/padding\n";
        break;
      default:
        content = `# ${art.path}\n\n${art.marker ? art.marker.source.replace(/[\\^$.*+?()[\]{}|]/g, "") : "x"}\n\nReal content.\n`;
    }
    writeFileSync(full, content);
  }
}

/** Run a set of stages to done (approving needed gates). */
function drive(projectDir, stages) {
  for (const s of stages) {
    fillStage(projectDir, s);
    const r = runStage(projectDir, s, { date: DATE });
    assert.equal(r.ok, true, `stage ${s}: ${JSON.stringify(r)}`);
  }
}

// ---------- path-sync guard ----------

test("STAGE_ARTEFACTS matches STAGE_SPEC paths (no drift)", () => {
  for (const [stage, paths] of Object.entries(STAGE_ARTEFACTS)) {
    const specPaths = STAGE_SPEC[stage].artefacts.map((a) => a.path).sort();
    assert.deepEqual([...paths].sort(), specPaths, `path drift in ${stage}`);
  }
});

// ---------- consistency ----------

test("a freshly scaffolded project audits clean", () => {
  const { root, projectDir } = fresh();
  try {
    assert.equal(audit(projectDir).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("audit flags an indexed asset that is missing on disk", () => {
  const { root, projectDir } = fresh();
  try {
    const m = JSON.parse(readFileSync(join(projectDir, ".harness/manifest.json"), "utf8"));
    m.assets.push({ name: "ghost.png", sha256: "x", bytes: 1, source: "ghost.png", ingestedAt: DATE });
    writeFileSync(join(projectDir, ".harness/manifest.json"), JSON.stringify(m, null, 2));
    const a = audit(projectDir);
    assert.equal(a.ok, false);
    assert.match(a.issues.map((i) => i.msg).join(), /asset indexed but missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- change-propagation ----------

test("editing the PRD after design flags Definition and everything downstream stale", () => {
  const { root, projectDir } = fresh();
  try {
    approve(projectDir, "G1", DATE);
    drive(projectDir, ["1-definition", "2-ia", "3-workflows", "4-wireframes"]);
    // No stale yet.
    assert.equal(staleStages(projectDir).length, 0);

    // Change an upstream input (the PRD) after downstream stages are done.
    writeFileSync(join(projectDir, "prd/PRD.md"), readFileSync(join(projectDir, "prd/PRD.md"), "utf8") + "\n## New requirement\n");

    const stale = staleStages(projectDir).map((s) => s.stage);
    assert.deepEqual(stale, ["1-definition", "2-ia", "3-workflows", "4-wireframes"]);
    const a = audit(projectDir);
    assert.equal(a.ok, false);
    assert.match(a.issues.map((i) => i.msg).join("\n"), /stale: 1-definition \(input changed: prd\/PRD.md\)/);
    // status reflects it too
    assert.deepEqual(status(projectDir).stale, stale);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("staleness blocks crossing the next gate even when it is approved", () => {
  const { root, projectDir } = fresh();
  try {
    // Complete definition + all design, approve G1 and G2.
    approve(projectDir, "G1", DATE);
    approve(projectDir, "G2", DATE);
    drive(projectDir, ["1-definition", "2-ia", "3-workflows", "4-wireframes", "5-visual"]);
    // Next gate is G2 before engineering; with no changes it advances.
    // Now change an upstream artefact to introduce staleness.
    writeFileSync(join(projectDir, "definition/acceptance-criteria.md"), "### AC-001\n- Expected: CHANGED result\n");
    const res = advance(projectDir, { date: DATE });
    assert.equal(res.stopped.reason, "audit blocked");
    assert.equal(res.stopped.gate, "G2");
    assert.match(res.stopped.issues.map((i) => i.msg).join("\n"), /stale/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("re-running a stale stage clears the staleness", () => {
  const { root, projectDir } = fresh();
  try {
    approve(projectDir, "G1", DATE);
    drive(projectDir, ["1-definition", "2-ia"]);
    writeFileSync(join(projectDir, "prd/PRD.md"), readFileSync(join(projectDir, "prd/PRD.md"), "utf8") + "\nedit\n");
    assert.ok(staleStages(projectDir).length > 0);
    // Re-run the directly-stale stage → its input hash is re-recorded.
    runStage(projectDir, "1-definition", { date: DATE });
    const stillStale = staleStages(projectDir).map((s) => s.stage);
    assert.ok(!stillStale.includes("1-definition"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
