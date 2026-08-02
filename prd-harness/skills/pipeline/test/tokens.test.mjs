import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateTokens } from "../tokens.mjs";
import { contrastRatio } from "../lib/color.mjs";
import { VALID_TOKENS_JSON } from "./fixtures.mjs";

/** Write a tokens.json (object or string) into a temp project and validate it. */
function check(tokens) {
  const dir = mkdtempSync(join(tmpdir(), "tokens-"));
  try {
    mkdirSync(join(dir, "design/design-system"), { recursive: true });
    writeFileSync(join(dir, "design/design-system/tokens.json"), typeof tokens === "string" ? tokens : JSON.stringify(tokens));
    const issues = validateTokens(dir);
    return { errors: issues.filter((i) => i.sev === "error").map((i) => i.msg), warns: issues.filter((i) => i.sev === "warn").map((i) => i.msg) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("absent tokens.json yields no issues", () => {
  const dir = mkdtempSync(join(tmpdir(), "tokens-"));
  try {
    assert.deepEqual(validateTokens(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the seed tokens.json passes with zero errors", () => {
  assert.deepEqual(check(VALID_TOKENS_JSON).errors, []);
});

test("invalid JSON is a single error", () => {
  const r = check("{ not json");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /not valid JSON/);
});

test("a leaf missing $type (with none inherited) errors", () => {
  const r = check({ primitive: { color: { blue: { $value: "#123456" } } } });
  assert.match(r.errors.join("\n"), /no \$type/);
});

test("an invalid $type errors", () => {
  const r = check({ primitive: { color: { $type: "colour", blue: { $value: "#123456" } } } });
  assert.match(r.errors.join("\n"), /is not a DTCG type/);
});

test("a broken alias errors", () => {
  const r = check({
    semantic: { color: { $type: "color", x: { $value: "{primitive.color.missing}" } } },
  });
  assert.match(r.errors.join("\n"), /unknown token/);
});

test("a circular alias errors", () => {
  const r = check({
    semantic: {
      color: { $type: "color", a: { $value: "{semantic.color.b}" }, b: { $value: "{semantic.color.a}" } },
    },
  });
  assert.match(r.errors.join("\n"), /circular alias/);
});

test("tier leakage (component → primitive) errors", () => {
  const r = check({
    primitive: { color: { $type: "color", blue: { 500: { $value: "#3b82f6" } } } },
    component: { button: { $type: "color", bg: { $value: "{primitive.color.blue.500}" } } },
  });
  assert.match(r.errors.join("\n"), /tier leakage/);
});

test("an upward reference (semantic → component) errors", () => {
  const r = check({
    semantic: { color: { $type: "color", x: { $value: "{component.button.bg}" } } },
    component: { button: { $type: "color", bg: { $value: "#3b82f6" } } },
  });
  assert.match(r.errors.join("\n"), /upward reference/);
});

test("a primitive holding an alias errors", () => {
  const r = check({
    primitive: { color: { $type: "color", a: { $value: "#3b82f6" }, b: { $value: "{primitive.color.a}" } } },
  });
  assert.match(r.errors.join("\n"), /must hold a raw value/);
});

test("an appearance-named semantic token errors", () => {
  const r = check({
    primitive: { color: { $type: "color", x: { $value: "#3b82f6" } } },
    semantic: { color: { $type: "color", blue: { $value: "{primitive.color.x}" } } },
  });
  assert.match(r.errors.join("\n"), /named by appearance/);
});

test("a missing dark-mode color value errors", () => {
  const r = check({
    $themes: ["light", "dark"],
    primitive: { color: { $type: "color", w: { $value: "#ffffff" } } },
    semantic: { color: { $type: "color", bg: { $value: { light: "{primitive.color.w}" } } } },
  });
  assert.match(r.errors.join("\n"), /missing "dark" mode value/);
});

test("insufficient contrast errors; sufficient passes", () => {
  const low = check({
    semantic: {
      color: {
        $type: "color",
        bg: { $value: "#ffffff" },
        fg: { $value: "#999999", $extensions: { qm: { contrastAgainst: "{semantic.color.bg}", min: 4.5 } } },
      },
    },
  });
  assert.match(low.errors.join("\n"), /contrast .* is below 4.5/);

  const ok = check({
    semantic: {
      color: {
        $type: "color",
        bg: { $value: "#ffffff" },
        fg: { $value: "#595959", $extensions: { qm: { contrastAgainst: "{semantic.color.bg}", min: 4.5 } } },
      },
    },
  });
  assert.ok(!ok.errors.some((e) => /contrast/.test(e)), ok.errors.join("\n"));
});

test("an unsupported color space cannot be contrast-verified (warn, not error)", () => {
  const r = check({
    semantic: {
      color: {
        $type: "color",
        bg: { $value: "oklch(1 0 0)" },
        fg: { $value: "oklch(0.2 0 0)", $extensions: { qm: { contrastAgainst: "{semantic.color.bg}" } } },
      },
    },
  });
  assert.ok(!r.errors.some((e) => /contrast/.test(e)));
  assert.match(r.warns.join("\n"), /cannot verify contrast/);
});

test("contrastRatio computes known values", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  assert.equal(contrastRatio("oklch(1 0 0)", "#000"), null);
});
