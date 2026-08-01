import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTRACT_VERSION, CONTRACT_FLOOR, checkContractMajor } from "../src/contract/version.mjs";

test("contract version is the v1 floor", () => {
  assert.equal(CONTRACT_VERSION, 1);
  assert.equal(CONTRACT_FLOOR, 1);
});

test("accepts the current major", () => {
  assert.deepEqual(checkContractMajor(1), { ok: true });
});

test("fails closed on an unknown future major", () => {
  const res = checkContractMajor(2);
  assert.equal(res.ok, false);
  assert.match(res.reason, /newer than this CLI understands/);
});

test("rejects missing and non-integer contract", () => {
  assert.equal(checkContractMajor(undefined).ok, false);
  assert.equal(checkContractMajor(null).ok, false);
  assert.equal(checkContractMajor(1.5).ok, false);
  assert.equal(checkContractMajor("1").ok, false);
});
