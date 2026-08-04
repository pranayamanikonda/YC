import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold } from "../../prd-intake/scaffold.mjs";
import { handoff, redactSecrets } from "../handoff.mjs";

const DATE = "2026-08-04";
const PRD = "# Digest App\n\n## Requirements\n1. A page to submit an update.\n2. A service posts a digest.\n\n## Assumptions\n- Slack only?\n";

function fresh() {
  const root = mkdtempSync(join(tmpdir(), "handoff-"));
  const { projectDir } = scaffold({ prdText: PRD, outDir: root, date: DATE });
  return { root, projectDir };
}

test("handoff writes a numbered doc with all five sections", () => {
  const { root, projectDir } = fresh();
  try {
    const r = handoff(projectDir, { date: DATE });
    assert.equal(r.seq, "0001");
    const full = join(projectDir, r.path);
    assert.ok(existsSync(full));
    const doc = readFileSync(full, "utf8");
    for (const h of ["## Conversation Summary", "## Current Status", "## Next Steps", "## Suggested Skills", "## References"]) {
      assert.ok(doc.includes(h), `missing section ${h}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Current Status reflects the manifest (tier + mask)", () => {
  const { root, projectDir } = fresh();
  try {
    const m = JSON.parse(readFileSync(join(projectDir, ".harness/manifest.json"), "utf8"));
    const doc = readFileSync(join(projectDir, handoff(projectDir, { date: DATE }).path), "utf8");
    assert.match(doc, new RegExp(`Tier / mask:.*${m.tier}`));
    assert.ok(doc.includes(m.phaseMask.join(" → ")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("References cite durable artefacts, not copies", () => {
  const { root, projectDir } = fresh();
  try {
    const doc = readFileSync(join(projectDir, handoff(projectDir, { date: DATE }).path), "utf8");
    assert.match(doc, /`memory\.md`/);
    assert.match(doc, /`\.harness\/ledger\//);
    // a reference is a short link line, not the file's contents pasted in
    assert.ok(!doc.includes("Durable curated memory (current state)"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("secrets in the summary are redacted", () => {
  const { root, projectDir } = fresh();
  try {
    const secret = "sk-ABCDEFGHIJKLMNOP0123456789";
    const doc = readFileSync(
      join(projectDir, handoff(projectDir, { date: DATE, summary: `used key ${secret} today` }).path),
      "utf8",
    );
    assert.ok(!doc.includes(secret), "raw secret must not appear");
    assert.match(doc, /\[REDACTED\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a handoff line is appended to the ledger; a second call increments the seq", () => {
  const { root, projectDir } = fresh();
  try {
    handoff(projectDir, { date: DATE });
    const second = handoff(projectDir, { date: DATE });
    assert.equal(second.seq, "0002");
    const m = JSON.parse(readFileSync(join(projectDir, ".harness/manifest.json"), "utf8"));
    const ledger = readFileSync(join(projectDir, `.harness/ledger/${m.project}.md`), "utf8");
    assert.match(ledger, /handoff #0001/);
    assert.match(ledger, /handoff #0002/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("redactSecrets covers common shapes", () => {
  assert.match(redactSecrets("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"), /\[REDACTED\]/);
  assert.match(redactSecrets("AWS AKIAABCDEFGHIJKLMNOP here"), /\[REDACTED\]/);
  assert.match(redactSecrets("password = hunter2xyz"), /password\s*=\s*\[REDACTED\]/);
  assert.equal(redactSecrets("nothing secret here"), "nothing secret here");
});
