/**
 * Wayfinder — plan a large or foggy effort as a **Map + investigation tickets**,
 * resolving the fog incrementally before committing to the pipeline. The harness
 * runs the linear stage graph well once the shape is known; wayfinding is what
 * you do *before* that, when a PRD is too big or too uncertain for one pass.
 *
 * Two artefacts under `<project>/wayfinder/`:
 *   - map.md            the destination + what's known + the fog (open questions)
 *   - tickets/<id>.md   one investigation per open question; each blocks the
 *                       destination or another ticket (a small dependency graph)
 *
 * The agent charts the map and writes ticket questions + resolutions; this engine
 * provides deterministic scaffolding and — crucially — the **lint** that blocks
 * G1 while a frontier ticket (one that blocks the destination) is still open.
 *
 * Plain markdown, zero dependencies. Mirrors the wiki skill's shape.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(here, "..", "..", "templates");

const TICKET_TYPES = new Set(["research", "prototype", "grilling", "task"]);
const TICKET_STATUS = new Set(["open", "claimed", "resolved", "out-of-scope"]);
/** Statuses that still hold the destination hostage. */
const OPEN_STATUS = new Set(["open", "claimed"]);
const FILL = "[[FILL]]";

/** @param {string} projectDir @returns {string} */
function wayfinderRoot(projectDir) {
  return join(projectDir, "wayfinder");
}
/** @param {string} projectDir @returns {string} */
function ticketsDir(projectDir) {
  return join(wayfinderRoot(projectDir), "tickets");
}

/**
 * Parse a file's flat scalar frontmatter (`key: value`).
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseFront(text) {
  const fm = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return fm;
}

/**
 * @param {string} name Template file in templates/.
 * @param {Record<string,string>} vars
 * @returns {string}
 */
function fillTemplate(name, vars) {
  let text = readFileSync(join(templatesDir, name), "utf8");
  for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{{${k}}}`, v);
  return text;
}

/**
 * @param {string} projectDir
 * @returns {Array<{ id: string, path: string, front: Record<string,string>, body: string }>}
 */
export function listTickets(projectDir) {
  const dir = ticketsDir(projectDir);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const full = join(dir, f);
    const text = readFileSync(full, "utf8");
    const front = parseFront(text);
    out.push({ id: front.id || basename(f, ".md"), path: relative(projectDir, full), front, body: text });
  }
  return out;
}

/** @param {string} projectDir @returns {string} next ticket id, WF-NNN. */
function nextTicketId(projectDir) {
  let max = 0;
  for (const t of listTickets(projectDir)) {
    const m = /WF-(\d+)/.exec(t.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `WF-${String(max + 1).padStart(3, "0")}`;
}

/** Best-effort ledger note (the map can exist before .harness). */
function note(projectDir, line, date) {
  const ledgerDir = join(projectDir, ".harness", "ledger");
  if (!existsSync(ledgerDir)) return;
  const lf = readdirSync(ledgerDir).find((f) => f.endsWith(".md"));
  if (lf) appendFileSync(join(ledgerDir, lf), `- ${date} · wayfinder ${line}\n`);
}

/**
 * Chart a new effort: create `wayfinder/map.md` around a destination.
 * @param {string} projectDir
 * @param {{ destination: string, title?: string, date?: string }} opts
 * @returns {{ path: string, created: boolean }}
 */
export function chart(projectDir, opts) {
  const destination = opts.destination;
  if (!destination) throw new Error("destination is required");
  const date = opts.date || new Date().toISOString().slice(0, 10);
  mkdirSync(ticketsDir(projectDir), { recursive: true });
  const full = join(wayfinderRoot(projectDir), "map.md");
  const created = !existsSync(full);
  if (created) {
    writeFileSync(full, fillTemplate("wayfinder-map.md", { title: opts.title || destination, destination, date }));
    note(projectDir, `chart: ${destination}`, date);
  }
  return { path: relative(projectDir, full), created };
}

/**
 * Open an investigation ticket.
 * @param {string} projectDir
 * @param {{ type: string, question: string, blocks?: string, date?: string }} opts
 * @returns {{ id: string, path: string }}
 */
export function ticket(projectDir, opts) {
  const type = opts.type;
  if (!TICKET_TYPES.has(type)) throw new Error(`unknown ticket type "${type}" (${[...TICKET_TYPES].join("|")})`);
  if (!opts.question) throw new Error("question is required");
  const date = opts.date || new Date().toISOString().slice(0, 10);
  mkdirSync(ticketsDir(projectDir), { recursive: true });
  const id = nextTicketId(projectDir);
  const blocks = opts.blocks || "destination";
  const full = join(ticketsDir(projectDir), `${id}.md`);
  writeFileSync(full, fillTemplate("wayfinder-ticket.md", { id, type, blocks, question: opts.question, date }));
  note(projectDir, `ticket ${id} (${type}) blocks ${blocks}`, date);
  return { id, path: relative(projectDir, full) };
}

/**
 * Resolve a ticket: record the answer and close it.
 * @param {string} projectDir
 * @param {string} id
 * @param {{ resolution: string, date?: string }} opts
 * @returns {{ id: string, path: string }}
 */
export function resolve(projectDir, id, opts) {
  if (!opts || !opts.resolution) throw new Error("resolution is required");
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const full = join(ticketsDir(projectDir), `${id}.md`);
  if (!existsSync(full)) throw new Error(`no such ticket: ${id}`);
  let text = readFileSync(full, "utf8");
  text = text.replace(/^status:.*$/m, "status: resolved");
  text = text.replace(/^updated:.*$/m, `updated: ${date}`);
  text = text.replace(/## Resolution\n[\s\S]*$/, `## Resolution\n${opts.resolution}\n`);
  writeFileSync(full, text);
  note(projectDir, `resolve ${id}`, date);
  return { id, path: relative(projectDir, full) };
}

/**
 * @param {string} projectDir
 * @returns {{ total: number, open: number, claimed: number, resolved: number, outOfScope: number, frontier: string[] }}
 */
export function status(projectDir) {
  const tickets = listTickets(projectDir);
  const by = (s) => tickets.filter((t) => t.front.status === s).length;
  const frontier = tickets
    .filter((t) => OPEN_STATUS.has(t.front.status) && t.front.blocks === "destination")
    .map((t) => t.id);
  return {
    total: tickets.length,
    open: by("open"),
    claimed: by("claimed"),
    resolved: by("resolved"),
    outOfScope: by("out-of-scope"),
    frontier,
  };
}

/**
 * Lint the wayfinder graph. Errors block gates when folded into the audit — the
 * point of charting is that a frontier ticket (one that blocks the destination)
 * must be resolved (or moved out of scope) before the pipeline crosses G1.
 * @param {string} projectDir
 * @returns {Array<{ sev: string, msg: string }>}
 */
export function lint(projectDir) {
  const root = wayfinderRoot(projectDir);
  if (!existsSync(root)) return []; // no chart → nothing to enforce
  const issues = [];
  const err = (msg) => issues.push({ sev: "error", msg: `wayfinder: ${msg}` });
  const warn = (msg) => issues.push({ sev: "warn", msg: `wayfinder: ${msg}` });

  if (!existsSync(join(root, "map.md"))) err("wayfinder/ exists but map.md is missing");

  const tickets = listTickets(projectDir);
  const ids = new Set(tickets.map((t) => t.id));
  const statusById = new Map(tickets.map((t) => [t.id, t.front.status]));

  for (const t of tickets) {
    const { front, body, path } = t;
    for (const key of ["id", "type", "status", "blocks"]) {
      if (front[key] === undefined || front[key] === "") err(`${path}: missing required frontmatter "${key}"`);
    }
    if (front.type && !TICKET_TYPES.has(front.type)) err(`${path}: unknown type "${front.type}"`);
    if (front.status && !TICKET_STATUS.has(front.status)) err(`${path}: unknown status "${front.status}"`);

    // `blocks` must resolve to the destination or an existing ticket.
    if (front.blocks && front.blocks !== "destination" && !ids.has(front.blocks)) {
      err(`${path}: blocks "${front.blocks}" — no such ticket`);
    }

    // A resolved ticket must carry a real resolution, not the stub.
    if (front.status === "resolved" && body.includes(FILL)) {
      err(`${path}: status is resolved but the Resolution still contains ${FILL}`);
    }

    // Frontier ticket still open → the fog blocking the destination isn't cleared.
    if (OPEN_STATUS.has(front.status) && front.blocks === "destination") {
      err(`${path}: open ${front.type} ticket blocks the destination — resolve it (or mark out-of-scope) before G1`);
    }

    // Adrift: still blocked on a ticket that is already closed.
    if (OPEN_STATUS.has(front.status) && ids.has(front.blocks)) {
      const target = statusById.get(front.blocks);
      if (target === "resolved" || target === "out-of-scope") {
        warn(`${path}: blocks ${front.blocks} which is already ${target} — re-point or resolve`);
      }
    }
  }

  return issues;
}

// ---------- CLI ----------
if (process.argv[1] && basename(process.argv[1]) === "wayfinder.mjs" && process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , cmd, projectDir, ...rest] = process.argv;
  const die = (m) => { process.stderr.write(m + "\n"); process.exit(1); };
  if (!cmd || !projectDir) die("usage: wayfinder.mjs <chart|ticket|resolve|status|lint> <projectDir> [args]");

  const flags = {};
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) {
      const key = rest[i].slice(2);
      const eq = key.indexOf("=");
      if (eq >= 0) flags[key.slice(0, eq)] = key.slice(eq + 1);
      else if (i + 1 < rest.length && !rest[i + 1].startsWith("--")) flags[key] = rest[++i];
      else flags[key] = true;
    } else pos.push(rest[i]);
  }

  if (cmd === "chart") {
    if (!flags.destination) die("usage: wayfinder.mjs chart <projectDir> --destination <text> [--title <t>]");
    const r = chart(projectDir, { destination: flags.destination, title: flags.title });
    process.stdout.write(`${r.created ? "+ charted" : "= exists"} ${r.path}\n`);
  } else if (cmd === "ticket") {
    if (!flags.type || !flags.question) die("usage: wayfinder.mjs ticket <projectDir> --type <t> --question <q> [--blocks <id|destination>]");
    const r = ticket(projectDir, { type: flags.type, question: flags.question, blocks: flags.blocks });
    process.stdout.write(`+ ${r.id}  ${r.path}\n`);
  } else if (cmd === "resolve") {
    const id = pos[0];
    if (!id || !flags.resolution) die("usage: wayfinder.mjs resolve <projectDir> <id> --resolution <text>");
    const r = resolve(projectDir, id, { resolution: flags.resolution });
    process.stdout.write(`= resolved ${r.id}\n`);
  } else if (cmd === "status") {
    const s = status(projectDir);
    process.stdout.write(
      `${s.total} tickets · ${s.open} open · ${s.claimed} claimed · ${s.resolved} resolved · ${s.outOfScope} out-of-scope\n` +
        `frontier (blocking destination): ${s.frontier.length ? s.frontier.join(", ") : "—"}\n`,
    );
  } else if (cmd === "lint") {
    const issues = lint(projectDir);
    if (!issues.length) process.stdout.write("✓ wayfinder lint clean\n");
    for (const i of issues) process.stdout.write(`  ${i.sev === "error" ? "✗" : "!"} ${i.msg}\n`);
    process.exit(issues.some((i) => i.sev === "error") ? 1 : 0);
  } else {
    die(`unknown command: ${cmd}`);
  }
}
