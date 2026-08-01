import { test } from "node:test";
import assert from "node:assert/strict";
import { compileApprovals, effectiveBinary } from "../src/contract/approvals.mjs";

test("effective binary prefers install.binary, falls back to id", () => {
  assert.equal(effectiveBinary({ id: "gh", install: { binary: "gh-cli" } }), "gh-cli");
  assert.equal(effectiveBinary({ id: "gh" }), "gh");
});

test("command rule is anchored to the effective binary", () => {
  const { rules, errors } = compileApprovals({
    id: "gh",
    approvals: [{ action: "deny", command: "auth login" }],
  });
  assert.deepEqual(errors, []);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].action, "deny");
  assert.equal(rules[0].source, "\\bgh\\b\\s+auth\\s+login");
  const re = new RegExp(rules[0].source);
  assert.ok(re.test("gh auth login"));
  assert.ok(!re.test("hub auth login"));
});

test("raw pattern must begin with the canonical boundary", () => {
  const bad = compileApprovals({
    id: "gh",
    approvals: [{ action: "ask", pattern: "auth login" }],
  });
  assert.equal(bad.rules.length, 0);
  assert.match(bad.errors[0], /must start with the canonical boundary/);

  const good = compileApprovals({
    id: "gh",
    approvals: [{ action: "ask", pattern: "\\bgh\\b\\s+auth" }],
  });
  assert.deepEqual(good.errors, []);
  assert.equal(good.rules.length, 1);
});

test("top-level alternation is rejected; nested alternation is allowed", () => {
  const topLevel = compileApprovals({
    id: "gh",
    approvals: [{ action: "deny", pattern: "\\bgh\\b auth|rm -rf" }],
  });
  assert.match(topLevel.errors[0], /top-level alternative/);

  const nested = compileApprovals({
    id: "gh",
    approvals: [{ action: "deny", pattern: "\\bgh\\b\\s+(auth|secret)\\s+login" }],
  });
  assert.deepEqual(nested.errors, []);
  assert.equal(nested.rules.length, 1);
});

test("only deny/ask are allowed — allow can never loosen policy", () => {
  const res = compileApprovals({
    id: "gh",
    approvals: [{ action: "allow", command: "auth login" }],
  });
  assert.equal(res.rules.length, 0);
  assert.match(res.errors[0], /may only tighten, never allow/);
});

test("a rule must set exactly one of command or pattern", () => {
  const both = compileApprovals({
    id: "gh",
    approvals: [{ action: "deny", command: "x", pattern: "\\bgh\\b y" }],
  });
  assert.match(both.errors[0], /exactly one of/);

  const neither = compileApprovals({ id: "gh", approvals: [{ action: "deny" }] });
  assert.match(neither.errors[0], /exactly one of/);
});

test("binary with regex-special characters is escaped in the boundary", () => {
  const { rules, errors } = compileApprovals({
    id: "aws.cli",
    approvals: [{ action: "ask", command: "configure" }],
  });
  assert.deepEqual(errors, []);
  assert.equal(rules[0].source, "\\baws\\.cli\\b\\s+configure");
});
