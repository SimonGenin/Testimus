import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ensureMcpJson } from "../claude/run.ts";
import { command, projectOf, UserError } from "../command.ts";
import { listJobs, runsIn } from "../jobs.ts";
import { stepColumns } from "../lib/columns.ts";
import { sha256 } from "../lib/hash.ts";
import {
  DEFAULT_PROJECT,
  DEFAULT_XRAY,
  forgetProject,
  isProject,
  projectsRoot,
  readJson,
  readProject,
  readSettings,
  readXray,
  rememberProject,
  writeJson,
  writeProject,
  writeXray,
} from "../lib/project.ts";
import { writeAtomic } from "../lib/store.ts";
import { awaitsReview, type ProjectJson, REVIEWS, type Review } from "../types.ts";
import { EFFORT, MODEL } from "./claude.ts";

const FOLDERS = ["docs", "tests", "contexts"];

export function templateDir(): string {
  const dev = fileURLToPath(new URL("../../../templates/project/", import.meta.url));
  if (existsSync(dev)) return dev;
  return join(dirname(process.argv[1] ?? "."), "templates", "project");
}

function files(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name), base) : [relative(base, join(dir, e.name)).replace(/\\/g, "/")],
  );
}

// ponytail: a new project starts with Xray Editor's one quick ask, edited or removed in Settings › Claude
export const STARTER_ASKS = [
  {
    label: "Rephrase in house style",
    prompt:
      "Rephrase the text in the house style: short imperative sentences, the actor prefix line kept as it is, one ◼ bullet per action. Keep the meaning and the images.",
  },
];

export function initProject(
  dir: string,
  p: { name?: string; jiraProject?: string; language?: string },
): { dir: string; created: string[]; kept: string[]; beside: string[] } {
  const root = resolve(dir);
  const tpl = templateDir();
  if (!existsSync(tpl)) throw new UserError(`Project template not found at ${tpl}.`, "Reinstall Testimus.");
  mkdirSync(root, { recursive: true });
  const created: string[] = [];
  const kept: string[] = [];
  const beside: string[] = [];
  const shippedFile = join(root, ".testimus", "shipped.json");
  const shipped = readJson<Record<string, string[]>>(shippedFile, {});
  const ship = (f: string, hash: string) => {
    shipped[f] = [...new Set([...(shipped[f] ?? []), hash])];
  };
  for (const f of files(tpl)) {
    const to = join(root, f);
    if (f === ".mcp.json") continue;
    const want = readFileSync(join(tpl, f));
    const wantHash = sha256(want);
    if (!existsSync(to)) {
      mkdirSync(dirname(to), { recursive: true });
      writeAtomic(to, want);
      created.push(f);
      ship(f, wantHash);
      continue;
    }
    // ponytail: CLAUDE.md is the team's once it exists; a shipped skill follows the app unless the team edited
    // it (it matches no version shipped here) — then theirs stays and the new one is written beside it
    if (f === "CLAUDE.md") {
      kept.push(f);
      continue;
    }
    const have = sha256(readFileSync(to));
    if (have !== wantHash && !(shipped[f] ?? []).includes(have)) {
      const next = f.replace(/(\.[^./]+)?$/, ".new$1");
      writeAtomic(join(root, next), want);
      kept.push(f);
      beside.push(next);
      continue;
    }
    if (have !== wantHash) writeAtomic(to, want);
    ship(f, wantHash);
  }
  writeJson(shippedFile, shipped);
  if (!existsSync(join(root, ".mcp.json"))) created.push(".mcp.json");
  ensureMcpJson(root);
  if (isProject(root)) {
    const cur = readProject(root);
    writeProject(root, {
      ...cur,
      name: p.name ?? cur.name,
      jiraProject: p.jiraProject ?? cur.jiraProject,
      language: p.language ?? cur.language,
    });
    kept.push("project.json");
  } else {
    const base = structuredClone(DEFAULT_PROJECT);
    writeProject(root, {
      ...base,
      claude: { ...base.claude, presets: [...STARTER_ASKS] },
      name: p.name ?? p.jiraProject ?? "",
      jiraProject: p.jiraProject ?? "",
      language: p.language ?? DEFAULT_PROJECT.language,
    });
    created.push("project.json");
  }
  if (existsSync(join(root, "xray.json"))) kept.push("xray.json");
  else {
    writeXray(root, structuredClone(DEFAULT_XRAY));
    created.push("xray.json");
  }
  for (const d of FOLDERS)
    if (!existsSync(join(root, d))) {
      mkdirSync(join(root, d), { recursive: true });
      created.push(`${d}/`);
    }
  rememberProject(root);
  return { dir: root, created, kept, beside };
}

function subdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

export function projectInfo(dir: string) {
  const xray = readXray(dir);
  const columns = stepColumns(dir, xray);
  const review = Object.fromEntries(REVIEWS.map((r) => [r, 0])) as Record<Review, number>;
  let tests = 0;
  let awaiting = 0;
  for (const id of subdirs(join(dir, "tests"))) {
    const f = join(dir, "tests", id, "test.md");
    if (!existsSync(f)) continue;
    tests++;
    const front = readFileSync(f, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
    const r = front.match(/^review:\s*"?([\w-]+)"?\s*$/m)?.[1] as Review | undefined;
    const state = r && REVIEWS.includes(r) ? r : "draft";
    review[state]++;
    if (awaitsReview({ review: state, generated: /^generated_by:\s*\S/m.test(front) })) awaiting++;
  }
  return {
    dir,
    project: readProject(dir),
    xray,
    fieldOrder: columns.map((c) => c.name),
    columns,
    counts: {
      docs: subdirs(join(dir, "docs")).filter((d) => existsSync(join(dir, "docs", d, "doc.json"))).length,
      tests,
      review,
      awaiting,
      jobsRunning: listJobs(dir).filter((j) => j.status === "running").length,
    },
  };
}

const PRESET = z.object({ label: z.string(), prompt: z.string() });

export const commands = [
  command({
    name: "project.init",
    summary: "Make a folder a Testimus project: template (CLAUDE.md, .mcp.json, skills), project.json, xray.json.",
    input: z.object({
      dir: z.string().describe("Folder to create or complete; an existing CLAUDE.md is kept."),
      jiraProject: z.string().optional().describe("Jira project key, e.g. LFRPS12."),
      name: z.string().optional().describe("Display name (default: the Jira key)."),
      language: z.string().optional().describe("Language of the generated tests (default fr)."),
    }),
    output: z.object({
      dir: z.string(),
      created: z.array(z.string()),
      kept: z.array(z.string()),
      beside: z
        .array(z.string())
        .describe("New shipped versions written beside a skill the team edited (SKILL.new.md), to merge by hand"),
    }),
    mutates: true,
    global: true,
    positional: ["dir"],
    async run(_ctx, input) {
      return initProject(input.dir, input);
    },
  }),
  command({
    name: "project.info",
    summary: "The open project: project.json, xray.json, field order and counts (docs, tests per review state, jobs).",
    input: z.object({}),
    output: z.object({
      dir: z.string(),
      project: z.unknown(),
      xray: z.unknown(),
      fieldOrder: z.array(z.string()),
      columns: z.array(z.unknown()).describe("The step columns and their descriptions (columns.list)"),
      counts: z.object({
        docs: z.number(),
        tests: z.number(),
        review: z.record(z.string(), z.number()),
        awaiting: z.number().describe("Generated tests not validated yet (review.queue)"),
        jobsRunning: z.number(),
      }),
    }),
    mutates: false,
    async run(ctx) {
      return projectInfo(projectOf(ctx));
    },
  }),
  command({
    name: "project.list",
    summary: "Known project folders (most recent first) and the last one opened.",
    input: z.object({}),
    output: z.object({
      last: z.string(),
      root: z
        .string()
        .describe(
          "Where a new project folder goes by default: D:\\Testimus\\Projects on Windows (C: when there is no D:), ~/Testimus/Projects elsewhere",
        ),
      projects: z.array(z.object({ dir: z.string(), name: z.string(), jiraProject: z.string(), exists: z.boolean() })),
    }),
    mutates: false,
    global: true,
    async run() {
      const s = readSettings();
      return {
        last: s.lastProject,
        root: projectsRoot(),
        projects: s.projects.map((dir) => {
          const exists = isProject(dir);
          const p = exists ? readProject(dir) : DEFAULT_PROJECT;
          return { dir, name: p.name, jiraProject: p.jiraProject, exists };
        }),
      };
    },
  }),
  command({
    name: "project.open",
    summary: "Make a project folder the current one (remembered in the settings).",
    input: z.object({ dir: z.string().describe("A folder that holds a project.json.") }),
    output: z.object({ dir: z.string(), name: z.string(), jiraProject: z.string() }),
    mutates: true,
    global: true,
    positional: ["dir"],
    async run(_ctx, input) {
      const dir = resolve(input.dir);
      if (!isProject(dir))
        throw new UserError(`${dir} is not a Testimus project.`, `testimus project init "${dir}" makes it one.`);
      rememberProject(dir);
      const p = readProject(dir);
      return { dir, name: p.name, jiraProject: p.jiraProject };
    },
  }),
  command({
    name: "project.forget",
    summary: "Stop showing a project in the known projects (the folder is kept, nothing changes in Jira).",
    input: z.object({ dir: z.string().describe("The project folder, as project.list shows it.") }),
    output: z.object({ dir: z.string(), forgotten: z.boolean().describe("False when the folder was not listed") }),
    mutates: true,
    global: true,
    positional: ["dir"],
    async run(_ctx, input) {
      const dir = resolve(input.dir);
      return { dir, forgotten: forgetProject(dir) };
    },
  }),
  command({
    name: "project.delete",
    summary:
      "Delete a project folder from this PC (documents, tests, index) and forget it. Nothing is deleted in Jira.",
    input: z.object({
      dir: z.string().describe("A known project folder (project.list), the open one included (the UI closes it)."),
    }),
    output: z.object({
      dir: z.string().describe("The project folder"),
      deleted: z.boolean().describe("False when the folder was already gone: the project is only forgotten"),
    }),
    mutates: true,
    global: true,
    positional: ["dir"],
    async run(_ctx, input) {
      const dir = resolve(input.dir);
      if (!readSettings().projects.some((p) => resolve(p) === dir))
        throw new UserError(`${dir} is not a known project.`, "Only a project listed by project.list is deleted.");
      if (!existsSync(dir)) {
        forgetProject(dir);
        return { dir, deleted: false };
      }
      if (!isProject(dir))
        throw new UserError(`${dir} is not a Testimus project.`, "Only a folder that holds a project.json is deleted.");
      if (runsIn(dir))
        throw new UserError(`A job is running in ${dir}.`, "Cancel it or let it end, then delete the project.");
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      forgetProject(dir);
      return { dir, deleted: true };
    },
  }),
  command({
    name: "project.openKey",
    summary:
      "Open a project by its Jira key (Xray Editor's « Go »): a known project with that key, else a new project folder named after it beside the current one.",
    input: z.object({
      key: z.string().describe("Jira project key, e.g. LFRPS12 (case does not matter)"),
      root: z
        .string()
        .optional()
        .describe(
          "Folder where a new project folder is made (default: beside the last project, else the projects folder)",
        ),
    }),
    output: z.object({ dir: z.string(), name: z.string(), jiraProject: z.string(), created: z.boolean() }),
    mutates: true,
    global: true,
    positional: ["key"],
    async run(_ctx, input) {
      const key = input.key.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_]*$/.test(key))
        throw new UserError(`${input.key} is not a Jira project key.`, "A key is letters and digits, such as LFRPS12.");
      const s = readSettings();
      const known = s.projects.filter(isProject).find((d) => readProject(d).jiraProject.toUpperCase() === key);
      let dir = known;
      let created = false;
      if (!dir) {
        const root = input.root
          ? resolve(input.root)
          : s.lastProject
            ? dirname(resolve(s.lastProject))
            : projectsRoot();
        dir = join(root, key);
        if (!isProject(dir)) {
          initProject(dir, { jiraProject: key, name: key });
          created = true;
        }
      }
      rememberProject(dir);
      const p = readProject(dir);
      return { dir, name: p.name, jiraProject: p.jiraProject, created };
    },
  }),
  command({
    name: "project.notes",
    summary: "The project notes: the text of the project's CLAUDE.md, which Claude reads in every run.",
    input: z.object({}),
    output: z.object({
      file: z.string().describe("Absolute path of CLAUDE.md"),
      text: z.string().describe("Its markdown, empty when the file is missing"),
    }),
    mutates: false,
    async run(ctx) {
      const file = join(projectOf(ctx), "CLAUDE.md");
      return { file, text: existsSync(file) ? readFileSync(file, "utf8") : "" };
    },
  }),
  command({
    name: "project.setNotes",
    summary: "Replace the project notes: writes the project's CLAUDE.md (the team's file, read by Claude).",
    input: z.object({ text: z.string().describe("The whole new markdown of CLAUDE.md") }),
    output: z.object({ file: z.string().describe("Absolute path of CLAUDE.md"), bytes: z.number() }),
    mutates: true,
    positional: ["text"],
    async run(ctx, input) {
      const file = join(projectOf(ctx), "CLAUDE.md");
      writeAtomic(file, input.text);
      return { file, bytes: Buffer.byteLength(input.text, "utf8") };
    },
  }),
  command({
    name: "project.set",
    summary:
      "Change project.json settings: name, Jira project, language, label prefix, folders, RAG and Claude defaults.",
    input: z.object({
      name: z.string().optional().describe("Display name."),
      jiraProject: z.string().optional().describe("Jira project key."),
      language: z.string().optional().describe("Language of the generated tests, e.g. fr or en."),
      labelPrefix: z.string().optional().describe("Prefix of the review labels pushed to Jira (default testimus-)."),
      folders: z.array(z.string()).optional().describe("Xray repository folders offered when generating."),
      rag: z
        .object({
          claudeHeaders: z
            .boolean()
            .optional()
            .describe("Claude writes a context header per chunk (costly; off by default)"),
          describeFigures: z
            .boolean()
            .optional()
            .describe("Claude describes the figures at conversion (on by default)"),
          reference: z
            .union([
              z.object({ pack: z.string().describe("Pack id: light, performance, balanced, quality") }),
              z.object({
                embedding: z.string().describe("Catalog id of the embedding"),
                reranker: z.string().nullable().describe("Catalog id of the reranker, or null"),
              }),
            ])
            .nullable()
            .optional()
            .describe("The team's reference configuration, measured by the benchmark (null removes it)"),
          queryTask: z
            .string()
            .optional()
            .describe("The task sentence of the query instruction ({task}); empty = default"),
          passageMaxChars: z.number().int().min(1000).optional().describe("Cap of a passage returned to Claude"),
          retrieval: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              "Retrieval settings: candidates, rrfK, bm25Weights, rerank { top, mode, threshold, thresholds }, expand",
            ),
        })
        .optional()
        .describe("Retrieval settings of the project (only the keys given change)."),
      glossary: z
        .record(z.string(), z.string())
        .optional()
        .describe("Acronyms and their long forms, added to the documents' own glossaries (replaces the list)"),
      claude: z
        .object({
          model: MODEL.optional().describe("Model alias or name"),
          effort: EFFORT.optional().describe("Effort level"),
          presets: z.array(PRESET).optional().describe("Request presets offered in the dock"),
          contexts: z
            .array(z.string().regex(/^[\w-]+$/, "A context id: letters, digits, _ and -"))
            .optional()
            .describe("Context ids attached to every run"),
        })
        .optional()
        .describe("Claude defaults: { model, effort, presets: [{label, prompt}], contexts: [ids] }."),
    }),
    output: z.unknown(),
    mutates: true,
    async run(ctx, input) {
      const dir = projectOf(ctx);
      const cur = readProject(dir);
      if (input.labelPrefix !== undefined && (!input.labelPrefix.trim() || /\s/.test(input.labelPrefix)))
        throw new UserError(
          `Not a label prefix: ${JSON.stringify(input.labelPrefix)}.`,
          "Use a non-empty prefix without spaces, e.g. testimus- — an empty one would take the team labels draft, checked, to-fix, validated.",
        );
      const next: ProjectJson = {
        ...cur,
        name: input.name ?? cur.name,
        jiraProject: input.jiraProject ?? cur.jiraProject,
        language: input.language ?? cur.language,
        labelPrefix: input.labelPrefix ?? cur.labelPrefix,
        folders: input.folders ?? cur.folders,
        ...(input.glossary ? { glossary: input.glossary } : {}),
        rag: {
          ...cur.rag,
          ...(input.rag?.queryTask !== undefined ? { queryTask: input.rag.queryTask } : {}),
          ...(input.rag?.passageMaxChars !== undefined ? { passageMaxChars: input.rag.passageMaxChars } : {}),
          ...(input.rag?.retrieval ? { retrieval: { ...cur.rag.retrieval, ...input.rag.retrieval } } : {}),
          ...((input.rag?.claudeHeaders ?? cur.rag.claudeHeaders) !== undefined && {
            claudeHeaders: input.rag?.claudeHeaders ?? cur.rag.claudeHeaders,
          }),
          ...((input.rag?.describeFigures ?? cur.rag.describeFigures) !== undefined && {
            describeFigures: input.rag?.describeFigures ?? cur.rag.describeFigures,
          }),
        },
        claude: {
          model: input.claude?.model ?? cur.claude.model,
          effort: input.claude?.effort ?? cur.claude.effort,
          presets: input.claude?.presets ?? cur.claude.presets,
          contexts: input.claude?.contexts ?? cur.claude.contexts,
        },
      };
      if (input.rag?.reference === null) delete next.rag.reference;
      else if (input.rag?.reference) next.rag.reference = input.rag.reference;
      writeProject(dir, next);
      return next;
    },
  }),
];
