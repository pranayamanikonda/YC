import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "../src/cli/check.mjs";

/** Build a throwaway deployment directory and return its path + a cleanup fn. */
function scaffold(files) {
  const dir = mkdtempSync(join(tmpdir(), "qm-check-"));
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const validConfig = JSON.stringify({
  contract: 1,
  orgId: "acme",
  publicUrl: "https://qm.acme.com",
  target: "docker",
  services: { core: true },
  sandbox: { app: "registry/qm-sandbox" },
});

test("check passes on a valid config-only directory", () => {
  const { dir, cleanup } = scaffold({ "qm.config.jsonc": validConfig });
  try {
    const res = runCheck({ dir });
    assert.equal(res.ok, true, JSON.stringify(res.findings));
  } finally {
    cleanup();
  }
});

test("check reports a load error when config is absent", () => {
  const { dir, cleanup } = scaffold({ "README.md": "x" });
  try {
    const res = runCheck({ dir });
    assert.equal(res.ok, false);
    assert.match(res.findings[0].message, /cannot load config/);
  } finally {
    cleanup();
  }
});

test("check validates the sandbox layer when present", () => {
  const { dir, cleanup } = scaffold({
    "qm.config.jsonc": validConfig,
    "sandbox/tools/gh/tool.json": JSON.stringify({ id: "gh", install: { binary: "gh" } }),
    "sandbox/skills/deploy/SKILL.md": "---\nname: Deploy\ndescription: Deploy QM\n---\nbody",
  });
  try {
    const res = runCheck({ dir });
    assert.equal(res.ok, true, JSON.stringify(res.findings));
  } finally {
    cleanup();
  }
});

test("check fails on a duplicate tool id and a skill missing frontmatter", () => {
  const { dir, cleanup } = scaffold({
    "qm.config.jsonc": validConfig,
    "sandbox/tools/gh/tool.json": JSON.stringify({ id: "dup", install: { binary: "gh" } }),
    "sandbox/tools/gh2/tool.json": JSON.stringify({ id: "dup", install: { binary: "gh" } }),
    "sandbox/skills/x/SKILL.md": "no frontmatter here",
  });
  try {
    const res = runCheck({ dir });
    assert.equal(res.ok, false);
    const msgs = res.findings.map((f) => f.message).join("\n");
    assert.match(msgs, /duplicate tool id "dup"/);
    assert.match(msgs, /missing SKILL.md frontmatter/);
    assert.equal(res.clauses["sandbox.descriptors"].status, "fail");
  } finally {
    cleanup();
  }
});

test("check surfaces an unparseable tool.json", () => {
  const { dir, cleanup } = scaffold({
    "qm.config.jsonc": validConfig,
    "sandbox/tools/gh/tool.json": "{ not json",
  });
  try {
    const res = runCheck({ dir });
    assert.equal(res.ok, false);
    assert.match(res.findings.map((f) => f.message).join(), /invalid tool.json/);
  } finally {
    cleanup();
  }
});

test("clauses group findings by contract id", () => {
  const { dir, cleanup } = scaffold({
    "qm.config.jsonc": JSON.stringify({
      contract: 1,
      orgId: "acme",
      publicUrl: "https://qm.acme.com",
      target: "docker",
      services: { core: true },
      sandbox: { app: "registry/x" },
      env: { API_TOKEN: "leak" },
    }),
  });
  try {
    const res = runCheck({ dir });
    assert.equal(res.ok, false);
    assert.ok("config.no-secret-values" in res.clauses);
    assert.equal(res.clauses["config.no-secret-values"].status, "fail");
  } finally {
    cleanup();
  }
});
