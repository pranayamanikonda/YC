/**
 * Design-system token validator (design/design-system/tokens.json, DTCG 2025.10).
 *
 * Deterministic, dependency-free proof of the token system, reusing the taxonomy
 * of the schema-validator / token-audit / naming-audit / theme-audit skills:
 *   A) structural DTCG validity,
 *   B) tier architecture (primitive → semantic → component), leakage, naming,
 *   C) theme coverage + WCAG contrast + interaction-state completeness.
 *
 * Returns the same `{ sev, msg }` issue shape used by audit(); errors flip
 * audit().ok and block the next gate. Tier is expressed as the top-level group
 * (`primitive`/`semantic`/`component`); a per-mode value is a `$value` object
 * keyed by a `$themes` mode; a contrast pair is declared via
 * `$extensions.qm.contrastAgainst` (+ optional `min`, default 4.5).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio, parseColor } from "./lib/color.mjs";

const DTCG_TYPES = new Set([
  "color", "dimension", "fontFamily", "fontWeight", "duration", "cubicBezier",
  "number", "strokeStyle", "border", "transition", "shadow", "gradient",
  "typography", "fontStyle",
]);
const COMPOSITE_TYPES = new Set(["border", "transition", "shadow", "gradient", "typography"]);
const ALLOWED_DOLLAR = new Set(["$value", "$type", "$description", "$extensions", "$deprecated"]);
const TIERS = { primitive: 0, semantic: 1, component: 2 };

const COLOR_WORDS = new Set(
  "red orange yellow green blue indigo violet purple pink brown gray grey black white cyan magenta teal navy amber lime".split(" "),
);
const SIZE_WORDS = new Set("tiny small medium large huge big".split(" "));
const CATEGORY_WORDS = new Set(
  "color spacing dimension size font fonts typography type radius shadow motion duration border".split(" "),
);
const STATE_WORDS = ["hover", "focus", "disabled"];

/**
 * @param {string} projectDir
 * @returns {Array<{ sev: string, msg: string }>}
 */
export function validateTokens(projectDir) {
  const path = join(projectDir, "design", "design-system", "tokens.json");
  if (!existsSync(path)) return [];

  const issues = [];
  const err = (msg) => issues.push({ sev: "error", msg: `token: ${msg}` });
  const warn = (msg) => issues.push({ sev: "warn", msg: `token: ${msg}` });

  let root;
  try {
    root = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return [{ sev: "error", msg: `token: tokens.json is not valid JSON — ${e.message}` }];
  }
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    return [{ sev: "error", msg: "token: tokens.json must be a JSON object" }];
  }

  const themes = Array.isArray(root.$themes) ? root.$themes.filter((t) => typeof t === "string") : [];
  for (const k of Object.keys(root)) {
    if (k.startsWith("$") && k !== "$themes" && !ALLOWED_DOLLAR.has(k)) err(`unknown root property "${k}"`);
  }

  // Flatten every tier into a token map: path -> { tier, type, value, node, name }.
  const tokens = new Map();
  for (const [key, group] of Object.entries(root)) {
    if (key.startsWith("$")) continue;
    if (!(key in TIERS)) {
      warn(`unknown top-level group "${key}" (expected primitive/semantic/component)`);
      continue;
    }
    if (group && typeof group === "object") walk(key, key, group, undefined);
  }

  /**
   * @param {string} tier
   * @param {string} path dotted path incl. tier
   * @param {object} node
   * @param {string|undefined} inheritedType
   */
  function walk(tier, path, node, inheritedType) {
    const type = typeof node.$type === "string" ? node.$type : inheritedType;
    // Reject stray $-props on any node.
    for (const k of Object.keys(node)) {
      if (k.startsWith("$") && !ALLOWED_DOLLAR.has(k)) err(`${path}: unknown property "${k}" ($-prefix is reserved)`);
    }
    if ("$value" in node) {
      tokens.set(path, { tier, path, type, value: node.$value, node, name: path.slice(tier.length + 1) });
      if (node.$description !== undefined && typeof node.$description !== "string") {
        err(`${path}: $description must be a string`);
      }
      return;
    }
    // Otherwise a group: descend into non-$ children.
    let childCount = 0;
    for (const [k, child] of Object.entries(node)) {
      if (k.startsWith("$")) continue;
      childCount++;
      if (child && typeof child === "object") walk(tier, `${path}.${k}`, child, type);
      else err(`${path}.${k}: expected a token or group object`);
    }
    if (childCount === 0) err(`${path}: neither a token ($value) nor a non-empty group`);
  }

  const stripRef = (s) => (typeof s === "string" && /^\{[^}]+\}$/.test(s.trim()) ? s.trim().slice(1, -1) : null);
  const isPerMode = (v) =>
    v && typeof v === "object" && !Array.isArray(v) && themes.length > 0 && Object.keys(v).every((k) => themes.includes(k));

  const referenced = new Set();

  // --- A: structural per-token checks + alias edges for B ---
  for (const t of tokens.values()) {
    if (!t.type) err(`${t.path}: no $type (and none inherited)`);
    else if (!DTCG_TYPES.has(t.type)) err(`${t.path}: $type "${t.type}" is not a DTCG type`);

    // Collect the concrete/alias values to check (per-mode expands).
    const entries = isPerMode(t.value) ? Object.entries(t.value) : [["*", t.value]];
    for (const [mode, val] of entries) {
      const ref = stripRef(val);
      if (ref) {
        referenced.add(ref);
        // Resolve for cycles / missing / hop count.
        const res = resolve(ref, mode);
        if (res.error) err(`${t.path}${mode === "*" ? "" : ` [${mode}]`}: ${res.error}`);
        else if (res.hops > 3) warn(`${t.path}: alias chain is ${res.hops} hops deep (keep ≤3)`);
        // B: tier-edge rule on the direct target.
        checkEdge(t, ref, mode);
      } else if (t.type === "color" && typeof val === "string") {
        if (!parseColor(val) && !/^(oklch|oklab|lab|lch|color)\(/i.test(val) && !/^[a-z]+$/i.test(val)) {
          err(`${t.path}: color value "${val}" is not a recognized color`);
        }
      } else if (t.type === "dimension" && typeof val === "string") {
        if (!/^-?\d*\.?\d+(px|rem|em|%|vh|vw|pt)$/.test(val)) {
          warn(`${t.path}: dimension "${val}" is not a number+unit`);
        }
      } else if (COMPOSITE_TYPES.has(t.type) && (val === null || typeof val !== "object")) {
        err(`${t.path}: composite type "${t.type}" needs an object value`);
      }
    }
  }

  /**
   * Follow an alias chain; report missing target / cycle; count hops.
   * @param {string} ref target path
   * @param {string} mode
   * @returns {{ error?: string, hops: number, terminal?: string }}
   */
  function resolve(ref, mode, seen = new Set()) {
    if (seen.has(ref)) return { error: `circular alias at {${ref}}`, hops: seen.size };
    const target = tokens.get(ref);
    if (!target) return { error: `alias {${ref}} points at an unknown token`, hops: seen.size };
    seen.add(ref);
    const val = isPerMode(target.value) ? target.value[mode] ?? target.value["*"] : target.value;
    const next = stripRef(val);
    if (next) return resolve(next, mode, seen);
    return { hops: seen.size, terminal: typeof val === "string" ? val : undefined };
  }

  /**
   * Tier-direction rule on a single alias edge.
   * @param {{ tier: string, path: string }} src
   * @param {string} ref
   * @param {string} mode
   */
  function checkEdge(src, ref, mode) {
    const target = tokens.get(ref);
    if (!target) return; // already reported by resolve()
    const s = TIERS[src.tier];
    const d = TIERS[target.tier];
    if (src.tier === "primitive") {
      err(`${src.path}: a primitive token must hold a raw value, not an alias to {${ref}}`);
    } else if (src.tier === "component" && target.tier === "primitive") {
      err(`${src.path}: tier leakage — a component token references the primitive {${ref}} directly; point it at a semantic token`);
    } else if (d > s) {
      err(`${src.path}: upward reference — a ${src.tier} token references the higher-tier {${ref}}`);
    }
  }

  // --- B: naming + orphans ---
  for (const t of tokens.values()) {
    if (t.tier === "semantic") {
      for (const seg of t.name.split(".")) {
        const w = seg.toLowerCase();
        if (CATEGORY_WORDS.has(w)) continue;
        if (COLOR_WORDS.has(w)) err(`${t.path}: semantic token named by appearance ("${seg}") — name it by intent/role`);
        else if (SIZE_WORDS.has(w)) warn(`${t.path}: semantic token uses an ambiguous size word ("${seg}")`);
      }
    }
    // Only primitives are true orphans if unused — semantic/component tokens are
    // consumed by code, not by other tokens.
    if (t.tier === "primitive" && !referenced.has(t.path)) {
      warn(`${t.path}: orphan primitive — defined but never referenced`);
    }
  }

  // --- C: theme coverage + contrast + states ---
  for (const t of tokens.values()) {
    if (themes.length && t.type === "color" && (t.tier === "semantic" || t.tier === "component")) {
      if (isPerMode(t.value)) {
        for (const mode of themes) {
          if (!(mode in t.value)) err(`${t.path}: missing "${mode}" mode value (color must resolve in every theme)`);
        }
      }
      // a mode-agnostic scalar/alias resolves in all modes → ok
    }

    const qm = t.node.$extensions?.qm;
    if (qm && typeof qm.contrastAgainst === "string") {
      const againstRef = stripRef(qm.contrastAgainst) || qm.contrastAgainst;
      const min = typeof qm.min === "number" ? qm.min : 4.5;
      const modes = themes.length ? themes : ["*"];
      for (const mode of modes) {
        const fg = concreteColor(t.path, mode);
        const bg = concreteColor(againstRef, mode);
        const label = mode === "*" ? "" : ` [${mode}]`;
        if (fg == null || bg == null) {
          warn(`${t.path}${label}: cannot verify contrast (unresolved or unsupported color space)`);
          continue;
        }
        const ratio = contrastRatio(fg, bg);
        if (ratio == null) warn(`${t.path}${label}: cannot verify contrast (unsupported color space)`);
        else if (ratio < min) err(`${t.path}${label}: contrast ${ratio.toFixed(2)}:1 against ${againstRef} is below ${min}:1`);
      }
    }
  }

  // Interaction-state completeness on component groups that have a `default`.
  const componentGroups = new Map();
  for (const t of tokens.values()) {
    if (t.tier !== "component") continue;
    const parent = t.path.slice(0, t.path.lastIndexOf("."));
    const leaf = t.path.slice(t.path.lastIndexOf(".") + 1);
    const g = componentGroups.get(parent) || new Set();
    g.add(leaf);
    componentGroups.set(parent, g);
  }
  for (const [group, states] of componentGroups) {
    if (states.has("default")) {
      const missing = STATE_WORDS.filter((s) => !states.has(s));
      if (missing.length) warn(`${group}: has "default" but is missing states: ${missing.join(", ")}`);
    }
  }

  /**
   * Resolve a token path to a concrete color string for a mode (following aliases
   * and per-mode values), or null if unresolved.
   * @param {string} path
   * @param {string} mode
   * @returns {string | null}
   */
  function concreteColor(path, mode, seen = new Set()) {
    if (seen.has(path)) return null;
    seen.add(path);
    const t = tokens.get(path);
    if (!t) return null;
    let val = isPerMode(t.value) ? t.value[mode] ?? t.value["*"] : t.value;
    const ref = stripRef(val);
    if (ref) return concreteColor(ref, mode, seen);
    return typeof val === "string" ? val : null;
  }

  return issues;
}
