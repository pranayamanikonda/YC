import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chart, ticket, resolve, status, lint, listTickets } from "../wayfinder.mjs";

const DATE = "2026-08-04";

function fresh() {
  const root = mkdtempSync(join(tmpdir(), "wayfinder-"));
  const projectDir = join(root, "proj");
  mkdirSync(projectDir, { recursive: true });
  return { root, projectDir };
}

test("chart creates the map + tickets dir; ticket writes frontmatter; resolve closes it", () => {
  const { root, projectDir } = fresh();
  try {
    const c = chart(projectDir, { destination: "Ship the digest", date: DATE });
    assert.equal(c.created, true);
    assert.ok(existsSync(join(projectDir, "wayfinder", "map.md")));
    assert.ok(existsSync(join(projectDir, "wayfinder", "tickets")));

    const t = ticket(projectDir, { type: "research", question: "Which channels?", date: DATE });
    assert.equal(t.id, "WF-001");
    const text = readFileSync(join(projectDir, t.path), "utf8");
    assert.match(text, /type: research/);
    assert.match(text, /status: open/);
    assert.match(text, /blocks: destination/);
    assert.match(text, /Which channels\?/);

    // second ticket increments the id
    const t2 = ticket(projectDir, { type: "task", question: "Q2", date: DATE });
    assert.equal(t2.id, "WF-002");

    resolve(projectDir, "WF-001", { resolution: "Slack only for v1.", date: DATE });
    const resolved = readFileSync(join(projectDir, t.path), "utf8");
    assert.match(resolved, /status: resolved/);
    assert.match(resolved, /Slack only for v1\./);
    assert.doesNotMatch(resolved, /\[\[FILL\]\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no wayfinder dir → lint is empty (existing projects unaffected)", () => {
  const { root, projectDir } = fresh();
  try {
    assert.deepEqual(lint(projectDir), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a chart with no tickets lints clean", () => {
  const { root, projectDir } = fresh();
  try {
    chart(projectDir, { destination: "X", date: DATE });
    assert.deepEqual(lint(projectDir), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an open frontier ticket is an error (blocks G1); resolving it clears the block", () => {
  const { root, projectDir } = fresh();
  try {
    chart(projectDir, { destination: "X", date: DATE });
    ticket(projectDir, { type: "research", question: "Q?", date: DATE });
    const issues = lint(projectDir);
    assert.ok(issues.some((i) => i.sev === "error" && /blocks the destination/.test(i.msg)));

    resolve(projectDir, "WF-001", { resolution: "answered", date: DATE });
    assert.ok(!lint(projectDir).some((i) => i.sev === "error"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("out-of-scope frontier tickets do not block", () => {
  const { root, projectDir } = fresh();
  try {
    chart(projectDir, { destination: "X", date: DATE });
    const t = ticket(projectDir, { type: "task", question: "Q?", date: DATE });
    let text = readFileSync(join(projectDir, t.path), "utf8").replace(/^status:.*$/m, "status: out-of-scope");
    writeFileSync(join(projectDir, t.path), text);
    assert.ok(!lint(projectDir).some((i) => i.sev === "error"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a broken blocks reference is an error", () => {
  const { root, projectDir } = fresh();
  try {
    chart(projectDir, { destination: "X", date: DATE });
    const t = ticket(projectDir, { type: "task", question: "Q?", blocks: "WF-999", date: DATE });
    // resolve it so the frontier error doesn't mask the broken-ref error
    resolve(projectDir, t.id, { resolution: "done", date: DATE });
    const issues = lint(projectDir);
    assert.ok(issues.some((i) => i.sev === "error" && /no such ticket/.test(i.msg)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("blocking an already-closed ticket warns (adrift)", () => {
  const { root, projectDir } = fresh();
  try {
    chart(projectDir, { destination: "X", date: DATE });
    const a = ticket(projectDir, { type: "research", question: "A?", date: DATE }); // WF-001, blocks destination
    ticket(projectDir, { type: "task", question: "B?", blocks: a.id, date: DATE }); // WF-002 blocks WF-001
    resolve(projectDir, a.id, { resolution: "closed A", date: DATE }); // WF-001 resolved, WF-002 still open
    const issues = lint(projectDir);
    assert.ok(issues.some((i) => i.sev === "warn" && /already resolved/.test(i.msg)));
    // and no error, since the only frontier ticket (WF-001) is resolved
    assert.ok(!issues.some((i) => i.sev === "error"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status reports counts and the frontier", () => {
  const { root, projectDir } = fresh();
  try {
    chart(projectDir, { destination: "X", date: DATE });
    ticket(projectDir, { type: "research", question: "A?", date: DATE });
    ticket(projectDir, { type: "task", question: "B?", date: DATE });
    resolve(projectDir, "WF-002", { resolution: "done", date: DATE });
    const s = status(projectDir);
    assert.equal(s.total, 2);
    assert.equal(s.resolved, 1);
    assert.deepEqual(s.frontier, ["WF-001"]);
    assert.equal(listTickets(projectDir).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
