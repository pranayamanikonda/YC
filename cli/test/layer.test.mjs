import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateToolDescriptor,
  validateSkill,
  validateSandboxLayer,
} from "../src/contract/layer.mjs";

test("only id is required on a tool", () => {
  assert.deepEqual(validateToolDescriptor({ id: "gh" }).errors, []);
  assert.match(validateToolDescriptor({}).errors[0], /id is required/);
});

test("credential paths must be $HOME-relative, non-traversing, with explicit kind", () => {
  const ok = validateToolDescriptor({
    id: "gh",
    auth: { credentialPaths: [{ path: ".config/gh/hosts.yml", kind: "file" }] },
  });
  assert.deepEqual(ok.errors, []);

  const absolute = validateToolDescriptor({
    id: "gh",
    auth: { credentialPaths: [{ path: "/etc/passwd", kind: "file" }] },
  });
  assert.match(absolute.errors.join(), /must be \$HOME-relative/);

  const traversal = validateToolDescriptor({
    id: "gh",
    auth: { credentialPaths: [{ path: "../../etc", kind: "directory" }] },
  });
  assert.match(traversal.errors.join(), /traversal/);

  const noKind = validateToolDescriptor({
    id: "gh",
    auth: { credentialPaths: [{ path: ".config/gh" }] },
  });
  assert.match(noKind.errors.join(), /must explicitly be "file" or "directory"/);
});

test(".ssh credential paths warn but do not fail", () => {
  const res = validateToolDescriptor({
    id: "ssh",
    auth: { credentialPaths: [{ path: ".ssh/id_ed25519", kind: "file" }] },
  });
  assert.deepEqual(res.errors, []);
  assert.match(res.warnings.join(), /~\/\.ssh/);
});

test("splitEnv allows only the {actingSlackUserId} placeholder", () => {
  const ok = validateToolDescriptor({
    id: "gh",
    auth: { splitEnv: { GH_ACTOR: "slack:{actingSlackUserId}" } },
  });
  assert.deepEqual(ok.errors, []);

  const bad = validateToolDescriptor({
    id: "gh",
    auth: { splitEnv: { GH_ACTOR: "{someoneElse}" } },
  });
  assert.match(bad.errors.join(), /unknown placeholder \{someoneElse\}/);
});

test("egress hosts validate and dangerous wildcards warn", () => {
  const ok = validateToolDescriptor({ id: "gh", egress: ["api.github.com", "*.githubusercontent.com"] });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.warnings, []);

  const dangerous = validateToolDescriptor({ id: "gh", egress: ["*"] });
  assert.match(dangerous.warnings.join(), /dangerously broad/);

  const midWildcard = validateToolDescriptor({ id: "gh", egress: ["api.*.com"] });
  assert.match(midWildcard.errors.join(), /only wildcard the leading label/);
});

test("skills require name and description frontmatter", () => {
  assert.deepEqual(
    validateSkill({ id: "deploy", frontmatter: { name: "Deploy", description: "how" } }).errors,
    [],
  );
  assert.match(validateSkill({ id: "deploy", frontmatter: { name: "Deploy" } }).errors.join(), /description/);
  assert.match(validateSkill({ id: "deploy", frontmatter: null }).errors.join(), /missing SKILL.md frontmatter/);
});

test("duplicate tool ids fail at the layer level", () => {
  const res = validateSandboxLayer({
    tools: [{ id: "gh" }, { id: "gh" }],
    skills: [],
  });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(), /duplicate tool id "gh"/);
});

test("a well-formed layer passes", () => {
  const res = validateSandboxLayer({
    tools: [
      { id: "gh", label: "GitHub CLI", advertise: true, install: { binary: "gh" } },
      { id: "jq", install: { binary: "jq" } },
    ],
    skills: [{ id: "deploy", frontmatter: { name: "Deploy", description: "Deploy QM" } }],
  });
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
});
