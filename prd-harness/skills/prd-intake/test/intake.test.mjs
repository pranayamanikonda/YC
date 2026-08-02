import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, PHASE_MASKS } from "../lib/classify.mjs";
import { buildXlsx } from "../lib/xlsx.mjs";
import { scaffold, slugify, PROJECT_TREE } from "../scaffold.mjs";

// ---------- classifier ----------

test("a large, multi-surface PRD classifies as large", () => {
  const text = "# App\n screen page view service dashboard endpoint\n api schema integration migration\n assume TBD unclear? maybe?";
  const res = classify(text);
  assert.equal(res.tier, "large");
  assert.deepEqual(res.mask, PHASE_MASKS.large);
});

test("a tiny copy tweak classifies as trivial with a minimal mask", () => {
  const res = classify("# Copy tweak\nChange the label on the button.");
  assert.equal(res.tier, "trivial");
  assert.deepEqual(res.mask, ["1-definition", "6-engineering", "7-ship"]);
});

test("security keywords floor the tier at standard", () => {
  const res = classify("# Small thing\nAdd a field. This touches auth and credential handling.");
  assert.ok(["standard", "large"].includes(res.tier));
  assert.equal(res.forced, true);
  assert.ok(res.mask.includes("2-ia"));
});

test("an explicit tier hint can raise but not lower the tier", () => {
  const raised = classify("# X\ntrivial body", { tierHint: "standard" });
  assert.equal(raised.tier, "standard");
  const notLowered = classify("# X\n screen page service api schema integration assume?", { tierHint: "trivial" });
  assert.equal(notLowered.tier, "large");
});

// ---------- xlsx writer ----------

test("buildXlsx produces a valid zip with the expected OOXML parts", () => {
  const buf = buildXlsx([{ name: "S1", rows: [["a", 1], ["b", 2]] }]);
  // ZIP local file header magic
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  // End-of-central-directory magic present near the tail
  const eocd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, "EOCD record present");
  const s = buf.toString("latin1");
  assert.ok(s.includes("[Content_Types].xml"));
  assert.ok(s.includes("xl/workbook.xml"));
  assert.ok(s.includes("xl/worksheets/sheet1.xml"));
});

test("numbers render as numeric cells, strings as inline text, and are escaped", () => {
  const buf = buildXlsx([{ name: "S", rows: [["a<b>&", 42]] }]);
  const s = buf.toString("utf8");
  assert.ok(s.includes("<v>42</v>"), "numeric cell");
  assert.ok(s.includes("a&lt;b&gt;&amp;"), "escaped inline string");
  assert.ok(s.includes('t="inlineStr"'));
});

test("buildXlsx rejects an empty workbook", () => {
  assert.throws(() => buildXlsx([]), /at least one sheet/);
});

// ---------- scaffolder ----------

const SAMPLE = `# Team Standup Digest\n\n## Requirements\n1. A web page and a Slack command to submit an update.\n2. A scheduled service posts a digest to a channel and a dashboard.\n\n## Assumptions to confirm\n- Slack only for v1?\n`;

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "prd-intake-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("slugify makes a filesystem-safe slug", () => {
  assert.equal(slugify("Team Standup Digest!"), "team-standup-digest");
  assert.equal(slugify("   "), "project");
});

test("scaffold creates the full project tree and a valid backlog.xlsx", () => {
  withTmp((dir) => {
    const res = scaffold({ prdText: SAMPLE, outDir: dir, date: "2026-08-02" });
    for (const sub of PROJECT_TREE) {
      assert.ok(existsSync(join(res.projectDir, sub)), `missing dir ${sub}`);
    }
    for (const f of [
      "prd/PRD.md",
      "prd/product-brief.md",
      "definition/epics.md",
      "definition/acceptance-criteria.md",
      "definition/backlog.xlsx",
      "docs/decisions/ADR-0001.md",
      "design/figma-links.md",
      "design/brief.md",
      "design/personas.md",
      "design/decisions.md",
      ".harness/manifest.json",
    ]) {
      assert.ok(existsSync(join(res.projectDir, f)), `missing file ${f}`);
    }
    const xlsx = readFileSync(join(res.projectDir, "definition/backlog.xlsx"));
    assert.equal(xlsx.readUInt32LE(0), 0x04034b50, "xlsx is a zip");
  });
});

test("scaffold normalizes the PRD and writes tier into frontmatter", () => {
  withTmp((dir) => {
    const res = scaffold({ prdText: SAMPLE, outDir: dir, date: "2026-08-02" });
    const prd = readFileSync(join(res.projectDir, "prd/PRD.md"), "utf8");
    assert.ok(prd.includes("source: normalized-by-prd-harness"));
    assert.ok(prd.includes(`tier: "${res.tier}"`));
  });
});

test("scaffold writes a manifest and a ledger with a HANDOFF to G1", () => {
  withTmp((dir) => {
    const res = scaffold({ prdText: SAMPLE, outDir: dir, date: "2026-08-02" });
    const manifest = JSON.parse(readFileSync(join(res.projectDir, ".harness/manifest.json"), "utf8"));
    assert.equal(manifest.tier, res.tier);
    assert.deepEqual(manifest.phaseMask, res.mask);
    assert.equal(manifest.stageStatus["0-intake"], "done");
    const ledger = readFileSync(join(res.projectDir, `.harness/ledger/${manifest.project}.md`), "utf8");
    assert.match(ledger, /HANDOFF from 0-intake → G1/);
  });
});

test("scaffold refuses to overwrite an existing project", () => {
  withTmp((dir) => {
    scaffold({ prdText: SAMPLE, outDir: dir, date: "2026-08-02" });
    assert.throws(() => scaffold({ prdText: SAMPLE, outDir: dir, date: "2026-08-02" }), /refusing to overwrite/);
  });
});

test("capability profile flows into the manifest and figma-links fallback", () => {
  withTmp((dir) => {
    const res = scaffold({ prdText: SAMPLE, outDir: dir, date: "2026-08-02", capabilities: { present: ["xlsx"] } });
    assert.deepEqual(res.manifest.capabilities, { present: ["xlsx"] });
    const links = readFileSync(join(res.projectDir, "design/figma-links.md"), "utf8");
    assert.match(links, /In-repo fallback/);
  });
});
