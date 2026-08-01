import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonc } from "../src/contract/jsonc.mjs";

test("parses standard JSON", () => {
  assert.deepEqual(parseJsonc('{"a":1,"b":[1,2,3]}'), { a: 1, b: [1, 2, 3] });
});

test("strips line and block comments", () => {
  const text = `{
    // a line comment
    "a": 1, /* inline */ "b": 2
    /* block
       comment */
  }`;
  assert.deepEqual(parseJsonc(text), { a: 1, b: 2 });
});

test("tolerates trailing commas", () => {
  assert.deepEqual(parseJsonc('{"a":1,}'), { a: 1 });
  assert.deepEqual(parseJsonc("[1,2,]"), [1, 2]);
});

test("does not strip comment-like or comma content inside strings", () => {
  assert.deepEqual(parseJsonc('{"url":"http://x/y","note":"a, b //c"}'), {
    url: "http://x/y",
    note: "a, b //c",
  });
});

test("preserves escaped quotes in strings", () => {
  assert.deepEqual(parseJsonc('{"q":"she said \\"hi\\" // ok"}'), {
    q: 'she said "hi" // ok',
  });
});
