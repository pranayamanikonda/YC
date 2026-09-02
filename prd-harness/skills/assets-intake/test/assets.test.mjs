import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold } from "../../prd-intake/scaffold.mjs";
import { ingest } from "../ingest.mjs";

const DATE = "2026-08-02";
const PRD = "# Asset Project\n\n## Requirements\n1. one screen\n";

function newProject() {
  const root = mkdtempSync(join(tmpdir(), "assets-"));
  const { projectDir } = scaffold({ prdText: PRD, outDir: root, date: DATE });
  return { root, projectDir };
}

function makeFile(dir, name, content) {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

test("ingest copies a file into assets/ and records it in the manifest", () => {
  const { root, projectDir } = newProject();
  try {
    const src = makeFile(root, "logo.svg", "<svg>brand</svg>");
    const res = ingest({ projectDir, files: [src], date: DATE });
    assert.equal(res.ingested.length, 1);
    const rec = res.ingested[0];
    assert.equal(rec.name, "logo.svg");
    assert.equal(rec.bytes, "<svg>brand</svg>".length);
    assert.match(rec.sha256, /^[0-9a-f]{64}$/);
    assert.ok(existsSync(join(projectDir, "assets", "logo.svg")));
    const manifest = JSON.parse(readFileSync(join(projectDir, ".harness/manifest.json"), "utf8"));
    assert.equal(manifest.assets.length, 1);
    assert.equal(manifest.assets[0].sha256, rec.sha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("identical content is skipped (idempotent), not duplicated", () => {
  const { root, projectDir } = newProject();
  try {
    const src = makeFile(root, "brand.png", "PNGDATA");
    ingest({ projectDir, files: [src], date: DATE });
    const again = ingest({ projectDir, files: [src], date: DATE });
    assert.equal(again.ingested.length, 0);
    assert.equal(again.skipped.length, 1);
    const manifest = JSON.parse(readFileSync(join(projectDir, ".harness/manifest.json"), "utf8"));
    assert.equal(manifest.assets.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a name collision with different content gets a hash suffix", () => {
  const { root, projectDir } = newProject();
  try {
    const a = makeFile(root, "a.txt", "one");
    ingest({ projectDir, files: [a], date: DATE });
    // second source, same base name, different content
    const sub = mkdtempSync(join(tmpdir(), "src2-"));
    const b = makeFile(sub, "a.txt", "two");
    const res = ingest({ projectDir, files: [b], date: DATE });
    assert.equal(res.ingested.length, 1);
    assert.notEqual(res.ingested[0].name, "a.txt");
    assert.match(res.ingested[0].name, /^a-[0-9a-f]{8}\.txt$/);
    assert.ok(existsSync(join(projectDir, "assets", "a.txt")));
    assert.ok(existsSync(join(projectDir, "assets", res.ingested[0].name)));
    rmSync(sub, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ingest records a ledger entry and validates inputs", () => {
  const { root, projectDir } = newProject();
  try {
    const src = makeFile(root, "ref.pdf", "%PDF-1.4");
    ingest({ projectDir, files: [src], date: DATE });
    const manifest = JSON.parse(readFileSync(join(projectDir, ".harness/manifest.json"), "utf8"));
    const ledger = readFileSync(join(projectDir, `.harness/ledger/${manifest.project}.md`), "utf8");
    assert.match(ledger, /assets ingested: \[ref.pdf\]/);
    assert.throws(() => ingest({ projectDir, files: [] }), /at least one file/);
    assert.throws(() => ingest({ projectDir, files: [join(root, "nope.bin")] }), /not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scaffold initializes an empty assets index and a memory.md", () => {
  const { root, projectDir } = newProject();
  try {
    const manifest = JSON.parse(readFileSync(join(projectDir, ".harness/manifest.json"), "utf8"));
    assert.deepEqual(manifest.assets, []);
    const memory = readFileSync(join(projectDir, "memory.md"), "utf8");
    assert.match(memory, /Confirmed facts/);
    assert.match(memory, /Open threads/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a subdir groups an ingest under assets/ and the manifest records the path", () => {
  const { root, projectDir } = newProject();
  try {
    const src = makeFile(root, "report.md", "# watched\n");
    const res = ingest({ projectDir, files: [src], subdir: "watched/a-video-2026-08-02", date: DATE });
    assert.equal(res.ingested[0].name, "watched/a-video-2026-08-02/report.md");
    assert.ok(existsSync(join(projectDir, "assets/watched/a-video-2026-08-02/report.md")));
    const manifest = JSON.parse(readFileSync(join(projectDir, ".harness/manifest.json"), "utf8"));
    assert.equal(manifest.assets[0].name, "watched/a-video-2026-08-02/report.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a subdir cannot escape assets/", () => {
  const { root, projectDir } = newProject();
  try {
    const src = makeFile(root, "x.txt", "x");
    assert.throws(() => ingest({ projectDir, files: [src], subdir: "../../etc", date: DATE }), /invalid subdir/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the same name in two subdirs is two assets, not a collision", () => {
  const { root, projectDir } = newProject();
  try {
    const a = makeFile(root, "report.md", "first");
    const b = makeFile(join(root, ""), "report2.md", "second");
    ingest({ projectDir, files: [a], subdir: "watched/one", date: DATE });
    const res = ingest({ projectDir, files: [b], subdir: "watched/two", date: DATE });
    assert.equal(res.ingested[0].name, "watched/two/report2.md");
    assert.ok(existsSync(join(projectDir, "assets/watched/one/report.md")));
    assert.ok(existsSync(join(projectDir, "assets/watched/two/report2.md")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
