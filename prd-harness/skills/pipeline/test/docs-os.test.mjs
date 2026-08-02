import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold } from "../../prd-intake/scaffold.mjs";
import { OWNERSHIP, STAGES } from "../lib/model.mjs";
import { designLint } from "../audit.mjs";
import { loadManifest } from "../lib/project.mjs";

const DATE = "2026-08-02";
const PRD = "# DocOS Project\n\n## Requirements\n1. one screen\n";

function fresh() {
  const root = mkdtempSync(join(tmpdir(), "docos-"));
  const { projectDir } = scaffold({ prdText: PRD, outDir: root, date: DATE });
  return { root, projectDir };
}

test("every stage has an ownership label", () => {
  for (const s of STAGES) assert.ok(OWNERSHIP[s], `missing ownership for ${s}`);
  assert.deepEqual(new Set(Object.values(OWNERSHIP)), new Set(["Agent", "Shared"]));
});

test("design-lint is quiet before the visual stage is done", () => {
  const { root, projectDir } = fresh();
  try {
    const m = loadManifest(projectDir);
    assert.equal(designLint(projectDir, m).filter((i) => i.sev === "error").length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("design-lint errors when visual is done but tokens are missing groups", () => {
  const { root, projectDir } = fresh();
  try {
    const m = loadManifest(projectDir);
    m.stageStatus["5-visual"] = "done";
    // tokens.md with only color, missing type + spacing
    mkdirSync(join(projectDir, "design/design-system"), { recursive: true });
    writeFileSync(join(projectDir, "design/design-system/tokens.md"), "# Tokens\ncolor palette: brandBlue\n");
    const errs = designLint(projectDir, m).filter((i) => i.sev === "error").map((i) => i.msg).join("\n");
    assert.match(errs, /no type tokens/);
    assert.match(errs, /no spacing tokens/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("design-lint warns on a raw color outside the tokens file", () => {
  const { root, projectDir } = fresh();
  try {
    const m = loadManifest(projectDir);
    writeFileSync(join(projectDir, "design/visual/visual-design.md"), "# Visual\nDirection: use #3366ff on buttons.\n");
    const warns = designLint(projectDir, m).filter((i) => i.sev === "warn").map((i) => i.msg).join("\n");
    assert.match(warns, /raw color in design\/visual\/visual-design.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("design-lint skips stub files still containing the FILL sentinel", () => {
  const { root, projectDir } = fresh();
  try {
    const m = loadManifest(projectDir);
    writeFileSync(join(projectDir, "design/visual/visual-design.md"), "# Visual\n#3366ff\n[[FILL]]\n");
    const warns = designLint(projectDir, m).filter((i) => /raw color/.test(i.msg));
    assert.equal(warns.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
