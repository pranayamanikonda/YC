/**
 * prd-intake scaffolder (Stage 0).
 *
 * Reads a PRD, classifies its size, and creates the per-project folder structure
 * from `process.md`, populating templates and generating a real `backlog.xlsx`.
 * Writes the harness manifest and opens the durable ledger with a HANDOFF to G1.
 *
 * Pure/deterministic given (prd text, projectDir, date): no clock or randomness
 * unless `date` is omitted (then it uses today). Kept dependency-free.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "./lib/classify.mjs";
import { buildXlsx } from "./lib/xlsx.mjs";
import { chart as wayfinderChart } from "../wayfinder/wayfinder.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(here, "..", "..", "templates");

/** Directories created under a project root. */
export const PROJECT_TREE = Object.freeze([
  "prd",
  "prd/research",
  "definition",
  "design/ia",
  "design/flows",
  "design/wireframes",
  "design/visual",
  "design/design-system",
  "docs/decisions",
  "docs/changes",
  "docs/plans/active",
  "docs/plans/completed",
  "docs/runbooks",
  "src",
  "tests",
  "artifacts",
  "assets",
  "wiki/entities",
  "wiki/decisions",
  "wiki/patterns",
  "wiki/gotchas",
  "wiki/glossary",
  ".harness/ledger",
]);

/**
 * @param {string} text
 * @returns {{ frontmatter: Record<string,string>, title: string }}
 */
function readMeta(text) {
  const fm = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const mm = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (mm) fm[mm[1]] = mm[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  const h1 = /^#\s+(.+)$/m.exec(text);
  const title = fm.title || (h1 ? h1[1].replace(/\s+—.*$/, "").trim() : "Untitled");
  return { frontmatter: fm, title };
}

/**
 * @param {string} title
 * @returns {string} filesystem-safe slug.
 */
export function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";
}

/**
 * @param {string} name Template filename in templates/.
 * @param {Record<string,string>} vars
 * @returns {string}
 */
function fillTemplate(name, vars) {
  let text = readFileSync(join(templatesDir, name), "utf8");
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{{${k}}}`, v);
  }
  return text;
}

/**
 * Build the seed backlog workbook (structure + one example row per sheet). The
 * product-manager agent fills real rows in Stage 1.
 * @param {string} title
 * @returns {Buffer}
 */
function seedBacklog(title) {
  return buildXlsx([
    {
      name: "Epics",
      rows: [
        ["ID", "Name", "Goal", "Priority"],
        ["EPIC-01", `${title} core`, "The primary outcome this product delivers", "must"],
      ],
    },
    {
      name: "Stories",
      rows: [
        ["ID", "Epic", "Story", "Acceptance"],
        ["STORY-01.1", "EPIC-01", "As a user, I want <capability>, so that <benefit>.", "AC-001"],
      ],
    },
    {
      name: "AcceptanceCriteria",
      rows: [
        ["ID", "Scenario", "Action", "Expected", "Priority"],
        ["AC-001", "<context>", "<user action>", "<observable result>", "must"],
      ],
    },
  ]);
}

/**
 * Scaffold a project from a PRD.
 * @param {object} opts
 * @param {string} opts.prdText Raw PRD markdown.
 * @param {string} opts.outDir Parent directory to create <project>/ in.
 * @param {string} [opts.date] ISO date (defaults to today).
 * @param {Record<string,string[]>} [opts.capabilities] Resolved capability profile.
 * @returns {{ projectDir: string, tier: string, mask: string[], manifest: object }}
 */
export function scaffold(opts) {
  const { prdText, outDir } = opts;
  if (typeof prdText !== "string" || prdText.length === 0) throw new Error("prdText is required");
  if (!outDir) throw new Error("outDir is required");
  const date = opts.date || new Date().toISOString().slice(0, 10);

  const { frontmatter, title } = readMeta(prdText);
  const { tier, mask, signals, forced } = classify(prdText, { tierHint: frontmatter.tier });
  // Chart the fog before committing when the effort is large or highly ambiguous.
  const needsChart = tier === "large" || (signals.ambiguityTier ?? 0) >= 2;
  const slug = slugify(title);
  const projectDir = join(outDir, slug);
  if (existsSync(projectDir)) throw new Error(`refusing to overwrite existing project: ${projectDir}`);

  for (const dir of PROJECT_TREE) mkdirSync(join(projectDir, dir), { recursive: true });

  const vars = { title, tier, date, mask: mask.join(" → "), n: "0001" };

  // Normalize the PRD as the source of truth (keep the author's body, ensure
  // the frontmatter carries tier/date the pipeline relies on).
  const normalizedPrd = prdText.includes("source: normalized-by-prd-harness")
    ? prdText
    : `---\ntitle: "${title}"\nstatus: draft\ntier: "${tier}"\ncreated: "${date}"\nsource: normalized-by-prd-harness\n---\n\n${prdText.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")}`;
  writeFileSync(join(projectDir, "prd", "PRD.md"), normalizedPrd);

  writeFileSync(join(projectDir, "prd", "product-brief.md"), fillTemplate("product-brief.md", vars));
  writeFileSync(join(projectDir, "definition", "epics.md"), fillTemplate("epics.md", vars));
  writeFileSync(join(projectDir, "definition", "acceptance-criteria.md"), fillTemplate("acceptance-criteria.md", vars));
  writeFileSync(join(projectDir, "definition", "backlog.xlsx"), seedBacklog(title));
  writeFileSync(join(projectDir, "docs", "decisions", "ADR-0001.md"), fillTemplate("adr.md", vars));
  writeFileSync(join(projectDir, "design", "figma-links.md"), figmaLinksStub(title, opts.capabilities));

  // Design-track artefacts (drafted in Figma downstream; these are the in-repo homes /
  // sources of truth with the mandatory Rationale + Accessibility annotations).
  writeFileSync(join(projectDir, "design", "brief.md"), fillTemplate("design-brief.md", vars));
  writeFileSync(join(projectDir, "design", "personas.md"), fillTemplate("personas.md", vars));
  writeFileSync(join(projectDir, "design", "decisions.md"), fillTemplate("decisions.md", vars));

  // Durable curated memory (current state) — distinct from the append-only ledger.
  writeFileSync(join(projectDir, "memory.md"), fillTemplate("memory.md", vars));
  writeFileSync(join(projectDir, "assets", "README.md"), assetsReadme());

  // LLM-maintained wiki (the compounding knowledge graph beside memory.md).
  writeFileSync(join(projectDir, "wiki", "home.md"), fillTemplate("wiki-home.md", vars));
  writeFileSync(join(projectDir, "wiki", "schema.json"), readFileSync(join(templatesDir, "wiki-schema.json"), "utf8"));

  // Documentation-OS deliverables: system overview, ship log, change records home.
  writeFileSync(join(projectDir, "docs", "system-overview.md"), fillTemplate("system-overview.md", vars));
  writeFileSync(join(projectDir, "ship-log.md"), fillTemplate("ship-log.md", vars));
  writeFileSync(
    join(projectDir, "docs", "changes", "README.md"),
    `# Change records\n\nOne record per meaningful change, as \`NNNN-slug.md\` (see\n\`prd-harness/templates/change-record.md\`). The durable why-behind-each-change; do not leave\nreasoning only in chat.\n`,
  );

  const manifest = {
    project: slug,
    title,
    tier,
    phaseMask: mask,
    signals,
    securityFloored: forced,
    capabilities: opts.capabilities || {},
    wayfinder: needsChart,
    assets: [],
    created: date,
    // Intake always ran (this is it); masked stages start pending.
    stageStatus: {
      "0-intake": "done",
      ...Object.fromEntries(mask.filter((s) => s !== "0-intake").map((s) => [s, "pending"])),
    },
  };
  writeFileSync(join(projectDir, ".harness", "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const chartLine = needsChart
    ? `- ${date} · HANDOFF from 0-intake → wayfinding · status=needs-decision · ` +
      `produced=[wayfinder/map.md]; chart the fog, resolve the frontier, then G1\n`
    : "";
  const ledger =
    `# Ledger — ${title}\n\n` +
    `- ${date} · stage 0-intake · scaffolded project; tier=${tier}; mask=[${mask.join(", ")}]` +
    `${forced ? "; security floor applied" : ""}${needsChart ? "; wayfinding required" : ""}\n` +
    chartLine +
    `- ${date} · HANDOFF from 0-intake → G1 · status=needs-decision · ` +
    `produced=[prd/PRD.md, prd/product-brief.md, definition/backlog.xlsx]\n`;
  writeFileSync(join(projectDir, ".harness", "ledger", `${slug}.md`), ledger);

  // Scaffold the wayfinder map (after the ledger exists so the note lands there).
  if (needsChart) wayfinderChart(projectDir, { destination: title, title, date });

  return { projectDir, tier, mask, manifest };
}

/**
 * @returns {string} The assets/ folder README documenting the intake convention.
 */
function assetsReadme() {
  return (
    `# Assets\n\n` +
    `Source assets for this project — logos, brand files, reference PDFs, images.\n\n` +
    `Ingest attached/uploaded files here (content-hashed, recorded in \`.harness/manifest.json\`):\n\n` +
    "```bash\n" +
    `node prd-harness/skills/assets-intake/ingest.mjs <projectDir> <file...>\n` +
    "```\n\n" +
    `Committed with the project, so they are durable. Keep large binaries out of git where a\n` +
    `link (Figma/Drive) will do; record such links in \`design/figma-links.md\`.\n`
  );
}

/**
 * @param {string} title
 * @param {Record<string,string[]>} [capabilities]
 * @returns {string}
 */
function figmaLinksStub(title, capabilities) {
  const hasFigma = capabilities && Array.isArray(capabilities.present) && capabilities.present.includes("figma");
  return (
    `# ${title} — design source coordinates\n\n` +
    `> The canonical location of each design artifact. When Figma is unavailable,\n` +
    `> the in-repo path (mermaid / HTML artifact) is the source instead.\n\n` +
    `| Artifact | Figma/FigJam URL | In-repo fallback |\n` +
    `| -------- | ---------------- | ---------------- |\n` +
    `| IA map | ${hasFigma ? "(to be created)" : "—"} | design/ia/ |\n` +
    `| Workflows | ${hasFigma ? "(to be created)" : "—"} | design/flows/ |\n` +
    `| Wireframes | ${hasFigma ? "(to be created)" : "—"} | design/wireframes/ |\n` +
    `| Design system | ${hasFigma ? "(to be created)" : "—"} | design/design-system/ |\n`
  );
}

// CLI entry: node scaffold.mjs <prd-file> [outDir]
if (process.argv[1] && basename(process.argv[1]) === "scaffold.mjs") {
  const [, , prdFile, outDirArg] = process.argv;
  if (!prdFile) {
    process.stderr.write("usage: node scaffold.mjs <prd-file> [outDir]\n");
    process.exit(1);
  }
  const prdText = readFileSync(prdFile, "utf8");
  const outDir = outDirArg || process.cwd();
  const res = scaffold({ prdText, outDir });
  process.stdout.write(`Scaffolded ${res.projectDir}\n  tier: ${res.tier}\n  mask: ${res.mask.join(" → ")}\n`);
}
