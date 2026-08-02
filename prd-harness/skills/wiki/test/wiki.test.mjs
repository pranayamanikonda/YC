import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold } from "../../prd-intake/scaffold.mjs";
import { hashFile } from "../../pipeline/lib/project.mjs";
import { audit } from "../../pipeline/audit.mjs";
import { parsePage, index, lint, ingest, query } from "../wiki.mjs";

const DATE = "2026-08-02";
const PRD = "# Wiki Project\n\n## Requirements\n1. one screen\n";

function fresh() {
  const root = mkdtempSync(join(tmpdir(), "wiki-"));
  const { projectDir } = scaffold({ prdText: PRD, outDir: root, date: DATE });
  return { root, projectDir };
}

/** Write a wiki page. */
function page(projectDir, rel, body) {
  const full = join(projectDir, "wiki", rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
  return full;
}

function fm(type, sources = "prd/PRD.md", hash = "null") {
  return `---\ntype: ${type}\ntitle: t\nupdated: ${DATE}\nsources:\n  - path: ${sources}  hash: ${hash}\ntags: []\n---\n`;
}

// ---------- parsePage ----------

test("parsePage extracts frontmatter, sources, links, and ignores code spans", () => {
  const p = parsePage(`---\ntype: entity\nupdated: ${DATE}\nsources:\n  - path: prd/PRD.md  hash: abc\ntags: [a, b]\n---\nBody links [[real]] but not \`[[example]]\` in code.\n`);
  assert.equal(p.frontmatter.type, "entity");
  assert.deepEqual(p.frontmatter.sources, [{ path: "prd/PRD.md", hash: "abc" }]);
  assert.deepEqual(p.frontmatter.tags, ["a", "b"]);
  assert.deepEqual(p.links, ["real"]);
});

test('parsePage reads hash: null as null', () => {
  const p = parsePage(fm("home", "memory.md", "null") + "# home\n");
  assert.equal(p.frontmatter.sources[0].hash, null);
});

// ---------- index ----------

test("index computes backlinks, orphans, and broken links", () => {
  const { root, projectDir } = fresh();
  try {
    page(projectDir, "entities/a.md", fm("entity") + "# A\nlinks [[b]] and [[ghost]]\n");
    page(projectDir, "entities/b.md", fm("entity") + "# B\nno links\n");
    const g = index(projectDir);
    assert.deepEqual(g.pages["b"].backlinks, ["a"]);
    assert.deepEqual(g.brokenLinks, [{ from: "a", to: "ghost" }]);
    assert.ok(g.orphans.includes("a")); // a has no inbound links
    assert.ok(!g.orphans.includes("b")); // b is linked by a
    assert.ok(existsSync(join(projectDir, "wiki/index.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- lint ----------

test("a freshly scaffolded wiki lints clean", () => {
  const { root, projectDir } = fresh();
  try {
    assert.equal(lint(projectDir).filter((i) => i.sev === "error").length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lint errors on a broken wikilink", () => {
  const { root, projectDir } = fresh();
  try {
    page(projectDir, "entities/a.md", fm("entity") + "# A\nsee [[nowhere]]\n");
    assert.match(lint(projectDir).map((i) => i.msg).join("\n"), /broken wikilink \[\[nowhere\]\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lint errors on missing frontmatter and a missing source", () => {
  const { root, projectDir } = fresh();
  try {
    page(projectDir, "entities/a.md", "# A\nno frontmatter\n");
    const msgs = lint(projectDir).map((i) => i.msg).join("\n");
    assert.match(msgs, /missing required frontmatter "type"/);
    page(projectDir, "entities/b.md", fm("entity", "prd/GONE.md", "x") + "# B\n[[home]]\n");
    assert.match(lint(projectDir).map((i) => i.msg).join("\n"), /cites missing source "prd\/GONE.md"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lint flags a STALE page when its cited source changed", () => {
  const { root, projectDir } = fresh();
  try {
    const h = hashFile(join(projectDir, "prd/PRD.md"));
    page(projectDir, "entities/a.md", fm("entity", "prd/PRD.md", h) + "# A\n[[home]]\n");
    assert.equal(lint(projectDir).filter((i) => i.sev === "error").length, 0);
    writeFileSync(join(projectDir, "prd/PRD.md"), readFileSync(join(projectDir, "prd/PRD.md"), "utf8") + "\nedit\n");
    assert.match(lint(projectDir).map((i) => i.msg).join("\n"), /STALE — source "prd\/PRD.md" changed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lint errors on an unsynthesized [[FILL]] stub without double-counting it as a broken link", () => {
  const { root, projectDir } = fresh();
  try {
    ingest(projectDir, { source: "prd/PRD.md", type: "entity", page: "x", date: DATE });
    const errs = lint(projectDir).filter((i) => i.sev === "error").map((i) => i.msg);
    assert.ok(errs.some((m) => /still contains \[\[FILL\]\]/.test(m)));
    assert.ok(!errs.some((m) => /broken wikilink \[\[FILL\]\]/.test(m)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- ingest ----------

test("ingest creates a page with provenance and a ledger entry; refresh updates the hash", () => {
  const { root, projectDir } = fresh();
  try {
    const r = ingest(projectDir, { source: "prd/PRD.md", type: "decision", page: "adopt-slack", date: DATE });
    assert.equal(r.created, true);
    assert.equal(r.path, "wiki/decisions/adopt-slack.md");
    const text = readFileSync(join(projectDir, r.path), "utf8");
    assert.match(text, new RegExp(`hash: ${hashFile(join(projectDir, "prd/PRD.md"))}`));
    const manifest = JSON.parse(readFileSync(join(projectDir, ".harness/manifest.json"), "utf8"));
    const ledger = readFileSync(join(projectDir, `.harness/ledger/${manifest.project}.md`), "utf8");
    assert.match(ledger, /wiki ingest: wiki\/decisions\/adopt-slack.md/);

    // change source, re-ingest same page → hash refreshed
    writeFileSync(join(projectDir, "prd/PRD.md"), "changed");
    const r2 = ingest(projectDir, { source: "prd/PRD.md", type: "decision", page: "adopt-slack", date: DATE });
    assert.equal(r2.created, false);
    assert.match(readFileSync(join(projectDir, r2.path), "utf8"), new RegExp(`hash: ${hashFile(join(projectDir, "prd/PRD.md"))}`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ingest rejects an unknown type and a missing source", () => {
  const { root, projectDir } = fresh();
  try {
    assert.throws(() => ingest(projectDir, { source: "prd/PRD.md", type: "bogus" }), /unknown page type/);
    assert.throws(() => ingest(projectDir, { source: "prd/NOPE.md", type: "entity" }), /source not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- query ----------

test("query returns matching pages with their backlinks", () => {
  const { root, projectDir } = fresh();
  try {
    page(projectDir, "entities/slack.md", fm("entity") + "# Slack\nthe chat surface\n");
    page(projectDir, "entities/digest.md", fm("entity") + "# Digest\nposts to [[slack]]\n");
    const res = query(projectDir, "slack");
    const slack = res.find((r) => r.page === "slack");
    assert.ok(slack);
    assert.deepEqual(slack.backlinks, ["digest"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- audit integration ----------

test("a broken wikilink makes the audit fail (blocks the gate)", () => {
  const { root, projectDir } = fresh();
  try {
    assert.equal(audit(projectDir).ok, true);
    page(projectDir, "entities/a.md", fm("entity") + "# A\n[[missing]]\n");
    const a = audit(projectDir);
    assert.equal(a.ok, false);
    assert.match(a.issues.map((i) => i.msg).join("\n"), /wiki:.*broken wikilink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("intake scaffolds a wiki home + schema", () => {
  const { root, projectDir } = fresh();
  try {
    assert.ok(existsSync(join(projectDir, "wiki/home.md")));
    assert.ok(existsSync(join(projectDir, "wiki/schema.json")));
    assert.match(readFileSync(join(projectDir, "wiki/home.md"), "utf8"), /type: home/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
