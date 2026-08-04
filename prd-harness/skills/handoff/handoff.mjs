/**
 * Handoff — a deterministic **session-compaction** snapshot so a fresh agent can
 * resume without the prior conversation. The harness already has a ledger (what
 * happened) and memory.md (what's true now); this is the third piece: a
 * point-in-time doc that says where we are, what's next, and where to look.
 *
 * Current Status / Next Steps / Suggested Skills are computed from the manifest,
 * the audit, and the wayfinder — no chat memory. The agent writes only the
 * Conversation Summary. References cite artefacts; they are never copied. The
 * whole document is scrubbed for secrets before it is written.
 *
 * Saved to `<project>/.harness/handoff/NNNN.md` (committed ⇒ survives the
 * ephemeral container, per STORAGE.md). Zero dependencies.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, ledger } from "../pipeline/lib/project.mjs";
import { STAGES, nextStage, gateBefore } from "../pipeline/lib/model.mjs";
import { audit } from "../pipeline/audit.mjs";
import { status as wayfinderStatus } from "../wayfinder/wayfinder.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(here, "..", "..", "templates");

/**
 * Redact common secret shapes so a compaction doc never carries a live key.
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED KEY]")
    .replace(/\bsk-[A-Za-z0-9]{16,}\b/g, "[REDACTED]")
    .replace(/\bghp_[A-Za-z0-9]{20,}\b/g, "[REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]")
    .replace(/\b(bearer)\s+[A-Za-z0-9._-]{12,}/gi, "$1 [REDACTED]")
    .replace(/\b(api[_-]?key|token|secret|password|passwd)(\s*[:=]\s*)['"]?[^\s'"]{6,}/gi, "$1$2[REDACTED]");
}

/**
 * @param {string} projectDir
 * @returns {string} next sequence, zero-padded to 4.
 */
function nextSeq(projectDir) {
  const dir = join(projectDir, ".harness", "handoff");
  if (!existsSync(dir)) return "0001";
  let max = 0;
  for (const f of readdirSync(dir)) {
    const m = /^(\d+)\.md$/.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return String(max + 1).padStart(4, "0");
}

/** Last `n` non-empty lines of the ledger, as a reference (not the whole log). */
function ledgerTail(projectDir, project, n) {
  const lf = join(projectDir, ".harness", "ledger", `${project}.md`);
  if (!existsSync(lf)) return [];
  return readFileSync(lf, "utf8").split(/\r?\n/).filter((l) => l.trim()).slice(-n);
}

/**
 * Compose (and write) a compaction handoff.
 * @param {string} projectDir
 * @param {{ summary?: string, date?: string }} [opts]
 * @returns {{ path: string, seq: string }}
 */
export function handoff(projectDir, opts = {}) {
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const m = loadManifest(projectDir);
  const a = audit(projectDir);
  const next = nextStage(m.phaseMask, m.stageStatus);
  const gate = next ? gateBefore(next) : null;
  const gateOpen = gate ? m.gates?.[gate] === "approved" : true;
  const wf = existsSync(join(projectDir, "wayfinder")) ? wayfinderStatus(projectDir) : null;

  // Current Status — deterministic from the manifest + audit.
  const stageLine = STAGES.filter((s) => m.phaseMask.includes(s))
    .map((s) => `${s}:${m.stageStatus[s] || "pending"}`)
    .join(" · ");
  const gateLine = Object.entries(m.gates || {}).map(([g, v]) => `${g}:${v}`).join(" · ");
  const blockedBy = !a.ok ? "audit (unresolved issues)" : !gateOpen ? `${gate} (awaiting approval)` : next || "—";
  const status = [
    `- **Tier / mask:** ${m.tier} · ${m.phaseMask.join(" → ")}`,
    `- **Stages:** ${stageLine}`,
    `- **Gates:** ${gateLine || "G1:pending · G2:pending · G3:pending"}`,
    `- **Next:** ${next || "complete"}${gate && !gateOpen ? ` (blocked by ${gate})` : ""}`,
    `- **Audit:** ${a.ok ? "clean" : `${a.issues.filter((i) => i.sev === "error").length} error(s)`}`,
    wf ? `- **Wayfinder:** ${wf.resolved}/${wf.total} resolved · frontier: ${wf.frontier.length ? wf.frontier.join(", ") : "—"}` : null,
    `- **Blocked by:** ${blockedBy}`,
  ].filter(Boolean).join("\n");

  // Next Steps — the shortest path forward.
  const steps = [];
  if (!a.ok) {
    for (const i of a.issues.filter((x) => x.sev === "error").slice(0, 4)) steps.push(`Clear audit error: ${i.msg}`);
  } else if (wf && wf.frontier.length) {
    steps.push(`Resolve the wayfinder frontier (${wf.frontier.join(", ")}) — it blocks G1.`);
  } else if (gate && !gateOpen) {
    steps.push(`Grill and approve ${gate}, then run stage ${next}.`);
  } else if (next) {
    steps.push(`Run stage ${next}.`);
  } else {
    steps.push("Pipeline complete — nothing outstanding.");
  }
  const nextSteps = steps.map((s) => `1. ${s}`).join("\n");

  // Suggested Skills — pointers, not prose.
  const suggested = [];
  if (wf && wf.frontier.length) suggested.push("`wayfinder` — resolve the open frontier tickets");
  if (gate && !gateOpen) suggested.push(`\`grilling\` — interrogate the plan before approving ${gate}`);
  if (!a.ok) suggested.push("`pipeline` audit (`run.mjs audit`) — see the blocking issues");
  if (next && a.ok && gateOpen) suggested.push(`\`pipeline\` — run stage ${next}`);
  suggested.push("`wiki query <term>` — recall prior findings before re-deriving");
  const suggestedBlock = suggested.map((s) => `- ${s}`).join("\n");

  // References — cite durable artefacts + the ledger tail; never duplicate them.
  const durable = ["memory.md", "wiki/home.md", ".harness/manifest.json", `.harness/ledger/${m.project}.md`]
    .filter((p) => existsSync(join(projectDir, p)));
  const refs = [
    ...durable.map((p) => `- [\`${p}\`](../../${p})`),
    "",
    "Recent ledger:",
    ...ledgerTail(projectDir, m.project, 6).map((l) => `  ${l}`),
  ].join("\n");

  // Assemble from the template, then redact.
  let doc = readFileSync(join(templatesDir, "handoff.md"), "utf8");
  const seq = nextSeq(projectDir);
  const vars = {
    project: m.project,
    title: m.title,
    date,
    seq,
    summary: opts.summary || "[[FILL]] — what happened this session, in a few lines.",
    status,
    nextSteps,
    suggested: suggestedBlock,
    references: refs,
  };
  for (const [k, v] of Object.entries(vars)) doc = doc.replaceAll(`{{${k}}}`, v);
  doc = redactSecrets(doc);

  const dir = join(projectDir, ".harness", "handoff");
  mkdirSync(dir, { recursive: true });
  const full = join(dir, `${seq}.md`);
  writeFileSync(full, doc);
  ledger(projectDir, `handoff #${seq} written (.harness/handoff/${seq}.md)`, date);
  return { path: join(".harness", "handoff", `${seq}.md`), seq };
}

// ---------- CLI ----------
if (process.argv[1] && basename(process.argv[1]) === "handoff.mjs" && process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , projectDir, ...rest] = process.argv;
  if (!projectDir) { process.stderr.write("usage: handoff.mjs <projectDir> [--summary <text>]\n"); process.exit(1); }
  let summary;
  const i = rest.indexOf("--summary");
  if (i >= 0) summary = rest.slice(i + 1).join(" ");
  const r = handoff(projectDir, { summary });
  process.stdout.write(`+ ${r.path}\n`);
}
