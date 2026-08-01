import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidFargateSize, fargateCpuValues } from "../src/contract/fargate.mjs";

test("known-good Fargate pairs", () => {
  assert.ok(isValidFargateSize(256, 512));
  assert.ok(isValidFargateSize(256, 2048));
  assert.ok(isValidFargateSize(512, 1024));
  assert.ok(isValidFargateSize(1024, 4096));
  assert.ok(isValidFargateSize(2048, 16384));
  assert.ok(isValidFargateSize(8192, 61440));
  assert.ok(isValidFargateSize(16384, 122880));
});

test("invalid pairs are rejected", () => {
  assert.ok(!isValidFargateSize(256, 256)); // below min
  assert.ok(!isValidFargateSize(256, 4096)); // above max for 256
  assert.ok(!isValidFargateSize(512, 1536)); // off-step
  assert.ok(!isValidFargateSize(300, 1024)); // unknown cpu
  assert.ok(!isValidFargateSize("1024", 2048)); // wrong type
});

test("cpu values are the documented set", () => {
  assert.deepEqual(fargateCpuValues(), [256, 512, 1024, 2048, 4096, 8192, 16384]);
});
