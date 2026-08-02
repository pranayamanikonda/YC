/**
 * LLM-maintained wiki (Karpathy's pattern): the agent synthesizes interlinked
 * markdown pages; this engine provides the deterministic scaffolding, the link
 * graph, provenance, and — crucially — the **Lint** that blocks gates.
 *
 * Three layers: immutable raw sources (prd/, research/, assets/, ledger) → the
 * LLM-maintained wiki/ → the schema. Operations:
 *   - index : build wiki/index.json (forward links, backlinks, orphans, tags)
 *   - lint  : broken links, missing frontmatter, STALE claims (source hash drift),
 *             missing sources, orphans, unresolved contradictions
 *   - ingest: scaffold/append a page with provenance (source + current hash + date)
 *   - query : deterministic search → matching pages + their backlinks
 *
 * Plain markdown + [[wikilinks]] — Obsidian-compatible, zero dependencies.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { hashFile } from "../pipeline/lib/project.mjs";

const REQUIRED_FRONTMATTER = ["type", "updated", "sources"];
const PAGE_TYPES = new Set(["home", "entity", "decision", "pattern", "gotcha", "glossary"]);
/** Page type → its wiki subdirectory. */
const TYPE_DIR = { entity: "entities", decision: "decisions", pattern: "patterns", gotcha: "gotchas", glossary: "glossary" };

/**
 * @param {string} projectDir
 * @returns {string} the wiki root.
 */
function wikiRoot(projectDir) {
  return join(projectDir, "wiki");
}

/**
 * Recursively list `.md` files under the wiki (excluding index.json).
 * @param {string} dir
 * @returns {string[]}
 */
function listPages(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listPages(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/**
 * Parse a page: YAML-ish frontmatter (flat scalars + a `sources` list of
 * `{ path, hash }`) and the `[[wikilinks]]` in the body.
 * @param {string} text
 * @returns {{ frontmatter: Record<string, any>, links: string[], body: string, tags: string[] }}
 */
export function parsePage(text) {
  const fm = {};
  const sources = [];
  let body = text;
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (m) {
    body = m[2];
    let inSources = false;
    for (const raw of m[1].split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, "");
      if (/^sources:\s*$/.test(line)) { inSources = true; fm.sources = sources; continue; }
      if (inSources) {
        // - path: X  hash: Y   (one entry per line)
        const s = /^\s*-\s*path:\s*(\S+)(?:\s+hash:\s*(\S+))?/.exec(line);
        if (s) { sources.push({ path: s[1], hash: s[2] && s[2] !== "null" ? s[2] : null }); continue; }
        if (/^\s+/.test(line)) continue; // nested detail
        inSources = false; // fall through to scalar parse
      }
      const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (kv) {
        let v = kv[2].trim();
        if (kv[1] === "sources") { inSources = true; fm.sources = sources; continue; }
        if (kv[1] === "tags") {
          fm.tags = v.replace(/^\[|\]$/g, "").split(",").map((t) => t.trim()).filter(Boolean);
        } else {
          fm[kv[1]] = v.replace(/^["']|["']$/g, "");
        }
      }
    }
    if (sources.length) fm.sources = sources;
  }
  // Ignore fenced + inline code so example `[[syntax]]` in docs isn't treated as
  // a real link (or a stub sentinel).
  const prose = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  const links = [...prose.matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1].split("|")[0].trim());
  const tags = fm.tags || [...prose.matchAll(/(?:^|\s)#([a-z0-9][a-z0-9-]*)/gi)].map((x) => x[1]);
  return { frontmatter: fm, links, body, prose, tags };
}

/**
 * A page's canonical link name = its filename without extension.
 * @param {string} fullPath
 * @returns {string}
 */
function pageName(fullPath) {
  return basename(fullPath, ".md");
}

/**
 * Build the link graph and write wiki/index.json.
 * @param {string} projectDir
 * @returns {{ pages: Record<string, any>, orphans: string[], brokenLinks: Array<{from:string,to:string}> }}
 */
export function index(projectDir) {
  const root = wikiRoot(projectDir);
  const files = listPages(root);
  /** @type {Record<string, any>} */
  const pages = {};
  const names = new Set(files.map(pageName));

  for (const file of files) {
    const rel = relative(projectDir, file);
    const { frontmatter, links, tags } = parsePage(readFileSync(file, "utf8"));
    pages[pageName(file)] = { path: rel, type: frontmatter.type || null, links, tags, backlinks: [] };
  }
  const broken = [];
  for (const [name, page] of Object.entries(pages)) {
    for (const link of page.links) {
      if (link === "FILL") continue;
      if (pages[link]) pages[link].backlinks.push(name);
      else broken.push({ from: name, to: link });
    }
  }
  const orphans = Object.entries(pages)
    .filter(([name, p]) => name !== "home" && p.type !== "home" && p.backlinks.length === 0)
    .map(([name]) => name);

  const out = { generated: true, pages, orphans, brokenLinks: broken };
  if (existsSync(root)) writeFileSync(join(root, "index.json"), JSON.stringify(out, null, 2) + "\n");
  return out;
}

/**
 * Lint the wiki. Errors block gates when folded into the audit.
 * @param {string} projectDir
 * @returns {Array<{ sev: string, msg: string }>}
 */
export function lint(projectDir) {
  const root = wikiRoot(projectDir);
  if (!existsSync(root)) return [];
  const issues = [];
  const err = (msg) => issues.push({ sev: "error", msg: `wiki: ${msg}` });
  const warn = (msg) => issues.push({ sev: "warn", msg: `wiki: ${msg}` });

  const files = listPages(root);
  const names = new Set(files.map(pageName));
  const backlinks = new Map();

  for (const file of files) {
    const rel = relative(projectDir, file);
    const { frontmatter, links, prose } = parsePage(readFileSync(file, "utf8"));

    // Required frontmatter.
    for (const key of REQUIRED_FRONTMATTER) {
      if (frontmatter[key] === undefined) err(`${rel}: missing required frontmatter "${key}"`);
    }
    if (frontmatter.type && !PAGE_TYPES.has(frontmatter.type)) {
      err(`${rel}: unknown page type "${frontmatter.type}"`);
    }
    // Unsynthesized stub (ignore code-span examples).
    if (prose.includes("[[FILL]]")) err(`${rel}: still contains [[FILL]] — page not yet synthesized`);
    // Unresolved contradiction.
    if (/#contradiction\b/i.test(prose)) warn(`${rel}: has an unresolved #contradiction`);

    // Provenance + STALE claims (reuses the same sha256 as stage staleness).
    const sources = Array.isArray(frontmatter.sources) ? frontmatter.sources : [];
    if (frontmatter.type && frontmatter.type !== "home" && sources.length === 0) {
      err(`${rel}: cites no sources (every claim must trace to a raw source)`);
    }
    for (const s of sources) {
      const abs = join(projectDir, s.path);
      const cur = hashFile(abs);
      if (cur === null) err(`${rel}: cites missing source "${s.path}"`);
      else if (s.hash && s.hash !== cur) {
        err(`${rel}: STALE — source "${s.path}" changed since last ingest; re-ingest this page`);
      }
    }

    // Broken wikilinks (the FILL sentinel is reported by the stub check above).
    for (const link of links) {
      if (link === "FILL") continue;
      if (!names.has(link)) err(`${rel}: broken wikilink [[${link}]] — no such page`);
      else backlinks.set(link, (backlinks.get(link) || 0) + 1);
    }
  }

  // Orphans (no inbound links; home is exempt).
  for (const file of files) {
    const name = pageName(file);
    if (name === "home") continue;
    const { frontmatter } = parsePage(readFileSync(file, "utf8"));
    if (frontmatter.type === "home") continue;
    if (!backlinks.get(name)) warn(`wiki/${relative(root, file)}: orphan page (no inbound links)`);
  }

  return issues;
}

/**
 * Scaffold or append a wiki page with provenance for a source. The agent then
 * synthesizes the body (replacing the [[FILL]] marker).
 * @param {string} projectDir
 * @param {{ source: string, type?: string, page?: string, date?: string }} opts
 * @returns {{ path: string, created: boolean }}
 */
export function ingest(projectDir, opts) {
  const { source } = opts;
  if (!source) throw new Error("source is required");
  const type = opts.type || "entity";
  if (!PAGE_TYPES.has(type)) throw new Error(`unknown page type "${type}"`);
  const date = opts.date || new Date().toISOString().slice(0, 10);

  const abs = join(projectDir, source);
  const hash = hashFile(abs);
  if (hash === null) throw new Error(`source not found: ${source}`);

  const slug = (opts.page || basename(source).replace(/\.[^.]+$/, "")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const dir = type === "home" ? wikiRoot(projectDir) : join(wikiRoot(projectDir), TYPE_DIR[type]);
  mkdirSync(dir, { recursive: true });
  const full = join(dir, `${slug}.md`);
  const created = !existsSync(full);

  if (created) {
    const page =
      `---\n` +
      `type: ${type}\n` +
      `title: ${slug}\n` +
      `updated: ${date}\n` +
      `sources:\n  - path: ${source}  hash: ${hash}\n` +
      `tags: []\n` +
      `---\n\n# ${slug}\n\n[[FILL]] — synthesize this page from its source(s); link related pages using wikilink syntax.\n\n## Sources\n- ${source}\n`;
    writeFileSync(full, page);
  } else {
    // Refresh provenance: append/refresh the source hash + bump `updated`.
    let text = readFileSync(full, "utf8");
    if (!new RegExp(`path:\\s*${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) {
      text = text.replace(/(sources:\n(?:\s*-\s*path:.*\n)*)/, `$1  - path: ${source}  hash: ${hash}\n`);
    } else {
      text = text.replace(new RegExp(`(path:\\s*${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+hash:\\s*)\\S+`), `$1${hash}`);
    }
    text = text.replace(/^updated:.*$/m, `updated: ${date}`);
    writeFileSync(full, text);
  }

  // Ledger note (best-effort; the wiki can exist before .harness).
  const ledgerDir = join(projectDir, ".harness", "ledger");
  if (existsSync(ledgerDir)) {
    const lf = readdirSync(ledgerDir).find((f) => f.endsWith(".md"));
    if (lf) appendFileSync(join(ledgerDir, lf), `- ${date} · wiki ${created ? "ingest" : "refresh"}: ${relative(projectDir, full)} ← ${source}\n`);
  }
  return { path: relative(projectDir, full), created };
}

/**
 * Deterministic search over pages; returns matches + their backlinks so the
 * agent reads the right subset rather than the whole vault.
 * @param {string} projectDir
 * @param {string} term
 * @returns {Array<{ page: string, path: string, backlinks: string[] }>}
 */
export function query(projectDir, term) {
  const graph = index(projectDir);
  const needle = String(term).toLowerCase();
  const out = [];
  for (const [name, page] of Object.entries(graph.pages)) {
    const text = readFileSync(join(projectDir, page.path), "utf8").toLowerCase();
    if (name.toLowerCase().includes(needle) || text.includes(needle) || (page.tags || []).some((t) => t.toLowerCase().includes(needle))) {
      out.push({ page: name, path: page.path, backlinks: page.backlinks });
    }
  }
  return out;
}

// ---------- CLI ----------
import { fileURLToPath } from "node:url";
if (process.argv[1] && basename(process.argv[1]) === "wiki.mjs" && process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , cmd, projectDir, ...rest] = process.argv;
  const die = (m) => { process.stderr.write(m + "\n"); process.exit(1); };
  if (!cmd || !projectDir) die("usage: wiki.mjs <index|lint|ingest|query> <projectDir> [args]");

  if (cmd === "index") {
    const g = index(projectDir);
    process.stdout.write(`${Object.keys(g.pages).length} pages · ${g.orphans.length} orphans · ${g.brokenLinks.length} broken links\n`);
  } else if (cmd === "lint") {
    const issues = lint(projectDir);
    if (!issues.length) process.stdout.write("✓ wiki lint clean\n");
    for (const i of issues) process.stdout.write(`  ${i.sev === "error" ? "✗" : "!"} ${i.msg}\n`);
    process.exit(issues.some((i) => i.sev === "error") ? 1 : 0);
  } else if (cmd === "ingest") {
    const flags = {};
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].startsWith("--")) {
        const key = rest[i].slice(2);
        const eq = key.indexOf("=");
        if (eq >= 0) flags[key.slice(0, eq)] = key.slice(eq + 1);
        else if (i + 1 < rest.length && !rest[i + 1].startsWith("--")) flags[key] = rest[++i];
        else flags[key] = true;
      }
    }
    if (!flags.source) die("usage: wiki.mjs ingest <projectDir> --source <path> [--type <t>] [--page <slug>]");
    const r = ingest(projectDir, { source: flags.source, type: flags.type, page: flags.page });
    process.stdout.write(`${r.created ? "+ created" : "= refreshed"} ${r.path}\n`);
  } else if (cmd === "query") {
    const results = query(projectDir, rest.join(" "));
    for (const r of results) process.stdout.write(`${r.page}  (${r.path})  ←[${r.backlinks.join(", ")}]\n`);
    if (!results.length) process.stdout.write("(no matches)\n");
  } else {
    die(`unknown command: ${cmd}`);
  }
}
