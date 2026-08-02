#!/usr/bin/env node
/**
 * Pipeline driver. Advances a scaffolded project stage by stage, honoring the
 * phase mask and stopping at any gate that is not yet human-approved or any
 * stage whose artefacts the agent has not finished.
 *
 *   node run.mjs status  <projectDir>
 *   node run.mjs advance <projectDir>            # run stages until blocked
 *   node run.mjs approve <projectDir> <G1|G2|G3> # record human gate approval
 *
 * `advance` is the loop: run the next stage; if it completed, continue; if it
 * scaffolded work or hit a gate, stop and report what is owed.
 */

import { basename } from "node:path";
import { STAGES, GATES, gateBefore, nextStage } from "./lib/model.mjs";
import { loadManifest, saveManifest, ledger } from "./lib/project.mjs";
import { runStage, STAGE_SPEC } from "./stage.mjs";

/**
 * @param {string} projectDir
 * @returns {object} A status snapshot.
 */
export function status(projectDir) {
  const m = loadManifest(projectDir);
  const next = nextStage(m.phaseMask, m.stageStatus);
  return {
    project: m.project,
    tier: m.tier,
    gates: m.gates,
    stages: m.phaseMask.filter((s) => s !== "0-intake").map((s) => ({ stage: s, status: m.stageStatus[s] || "pending" })),
    next,
    blockedBy: next ? (gateBefore(next) && m.gates[gateBefore(next)] !== "approved" ? gateBefore(next) : null) : null,
    complete: next === null,
  };
}

/**
 * Approve a gate (records a human decision).
 * @param {string} projectDir
 * @param {string} gate
 * @param {string} [date]
 */
export function approve(projectDir, gate, date = new Date().toISOString().slice(0, 10)) {
  if (!GATES.includes(gate)) throw new Error(`unknown gate: ${gate} (expected ${GATES.join("|")})`);
  const m = loadManifest(projectDir);
  m.gates[gate] = "approved";
  saveManifest(projectDir, m);
  ledger(projectDir, `GATE ${gate} approved`, date);
  return { gate, status: "approved" };
}

/**
 * Advance the pipeline until it blocks (gate or unfinished stage) or completes.
 * @param {string} projectDir
 * @param {{ date?: string }} [opts]
 * @returns {{ ran: string[], stopped: object }}
 */
export function advance(projectDir, opts = {}) {
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const ran = [];
  // Bounded by the number of runnable stages; each iteration either advances or stops.
  for (let i = 0; i < STAGES.length + 1; i++) {
    const m = loadManifest(projectDir);
    const next = nextStage(m.phaseMask, m.stageStatus);
    if (next === null) return { ran, stopped: { reason: "pipeline complete" } };

    const gate = gateBefore(next);
    if (gate && m.gates[gate] !== "approved") {
      return { ran, stopped: { stage: next, gate, reason: `awaiting ${gate} approval` } };
    }

    const res = runStage(projectDir, next, { date });
    if (res.ok) {
      ran.push(next);
      continue;
    }
    return { ran, stopped: res };
  }
  return { ran, stopped: { reason: "step budget exhausted" } };
}

// ---------- CLI ----------
if (process.argv[1] && basename(process.argv[1]) === "run.mjs") {
  const [, , cmd, projectDir, gate] = process.argv;
  const die = (m) => {
    process.stderr.write(m + "\n");
    process.exit(1);
  };
  if (!cmd || !projectDir) die("usage: run.mjs <status|advance|approve> <projectDir> [gate]");

  if (cmd === "status") {
    process.stdout.write(JSON.stringify(status(projectDir), null, 2) + "\n");
  } else if (cmd === "approve") {
    if (!gate) die("usage: run.mjs approve <projectDir> <G1|G2|G3>");
    approve(projectDir, gate);
    process.stdout.write(`${gate} approved\n`);
  } else if (cmd === "advance") {
    const res = advance(projectDir);
    for (const s of res.ran) process.stdout.write(`✓ ran ${s} (${STAGE_SPEC[s].title})\n`);
    const st = res.stopped;
    if (st.reason === "pipeline complete") process.stdout.write("● pipeline complete\n");
    else if (st.gate) process.stdout.write(`■ stopped at ${st.gate} before ${st.stage} — approve to continue\n`);
    else if (st.issues) {
      process.stdout.write(`■ stopped in ${st.stage} — agent must complete:\n`);
      for (const iss of st.issues) process.stdout.write(`    - ${iss}\n`);
    } else process.stdout.write(`■ stopped: ${st.reason || JSON.stringify(st)}\n`);
  } else {
    die(`unknown command: ${cmd}`);
  }
}
