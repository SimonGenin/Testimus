import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { EFFORT, MODEL } from "../claude/schemas.ts";
import { command, projectOf, UserError } from "../command.ts";
import { runsIn } from "../jobs.ts";
import { fileMtime, unchangedSince, writeAtomic } from "../lib/atomic.ts";
import {
  DEFAULT_PROJECT,
  forgetProject,
  isProject,
  projectsRoot,
  readProject,
  readSettings,
  rememberProject,
  writeProject,
} from "../lib/project.ts";
import { projectOverview } from "../lib/project-info.ts";
import { initProject } from "../lib/project-init.ts";
import { retrievalOverride } from "../rag/schemas.ts";
import type { RetrievalOverride } from "../rag/search/filter.ts";
import { IF_MTIME, PRESET, PROJECT_JSON, RAG_CHOICE, STEP_COLUMN, XRAY_JSON } from "../schemas.ts";
import type { ProjectJson } from "../types.ts";

const opened = z.object({
  dir: z.string().describe("The project folder"),
  name: z.string().describe("Its display name"),
  jiraProject: z.string().describe("Its Jira project key"),
});

// ponytail: project.json keeps retrieval as an override — the keys given change, a rerank key too
function withRetrieval(cur: ProjectJson["rag"]["retrieval"], over: RetrievalOverride): ProjectJson["rag"]["retrieval"] {
  const rerank = over.rerank ? { rerank: { ...cur?.rerank, ...over.rerank } } : {};
  return { ...cur, ...over, ...rerank } as ProjectJson["rag"]["retrieval"];
}

const notesFile = (ctxProject: string) => join(ctxProject, "CLAUDE.md");

export const commands = [
  command({
    name: "project.init",
    summary:
      "Make a folder a Testimus project (template: CLAUDE.md, .mcp.json, skills; project.json, xray.json) and make it the current one.",
    input: z.object({
      dir: z.string().describe("Folder to create or complete; an existing CLAUDE.md is kept."),
      jiraProject: z.string().optional().describe("Jira project key, e.g. LFRPS12."),
      name: z.string().optional().describe("Display name (default: the Jira key)."),
      language: z.string().optional().describe("Language of the generated tests (default fr)."),
    }),
    output: opened.extend({
      created: z.array(z.string()).describe("Files and folders written for the first time"),
      kept: z.array(z.string()).describe("Files already there and left as they were"),
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
    summary:
      "The open project: project.json, xray.json, its step columns and counts (docs, tests per review state, jobs).",
    input: z.object({}),
    output: z.object({
      dir: z.string().describe("The project folder"),
      project: PROJECT_JSON.describe("project.json"),
      xray: XRAY_JSON.describe("xray.json: Xray's step fields as last read"),
      fieldOrder: z.array(z.string()).describe("The step column names in display order"),
      columns: z.array(STEP_COLUMN).describe("The step columns and their descriptions (as columns.list gives them)"),
      counts: z.object({
        docs: z.number().describe("Documents"),
        tests: z.number().describe("Tests"),
        review: z.record(z.string(), z.number()).describe("Tests per review state"),
        awaiting: z.number().describe("Generated tests not validated yet (review.queue)"),
        jobsRunning: z.number().describe("Jobs running in this project"),
      }),
    }),
    mutates: false,
    async run(ctx) {
      return projectOverview(projectOf(ctx));
    },
  }),
  command({
    name: "project.list",
    summary: "Known project folders (most recent first) and the last one opened.",
    input: z.object({}),
    output: z.object({
      last: z.string().describe("The project opened last (empty when none)"),
      root: z
        .string()
        .describe(
          "Where a new project folder goes by default: D:\\Testimus\\Projects on Windows (C: when there is no D:), ~/Testimus/Projects elsewhere",
        ),
      projects: z
        .array(opened.extend({ exists: z.boolean().describe("The folder still holds a project.json") }))
        .describe("Known projects, most recent first"),
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
    output: opened,
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
    output: z.object({
      dir: z.string().describe("The project folder"),
      forgotten: z.boolean().describe("False when the folder was not listed"),
    }),
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
      "Open a project by its Jira key (Xray Editor's « Go »): a known project with that key, else a new project folder named after it beside the current one; it becomes the current project.",
    input: z.object({
      key: z.string().describe("Jira project key, e.g. LFRPS12 (case does not matter)"),
      root: z
        .string()
        .optional()
        .describe(
          "Folder where a new project folder is made (default: beside the last project, else the projects folder)",
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe("Only say which folder would open, and whether it would be created; nothing is made or remembered"),
    }),
    output: opened.extend({
      created: z.boolean().describe("A new project folder was made (with dryRun: would be made)"),
    }),
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
          if (input.dryRun) return { dir, name: key, jiraProject: key, created: true };
          initProject(dir, { jiraProject: key, name: key });
          created = true;
        }
      }
      if (input.dryRun) {
        const p = readProject(dir);
        return { dir, name: p.name, jiraProject: p.jiraProject, created: false };
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
      mtime: z.number().describe("Its modification time (ms, rounded; 0 when missing): project.setNotes ifMtime"),
    }),
    mutates: false,
    async run(ctx) {
      const file = notesFile(projectOf(ctx));
      return { file, text: existsSync(file) ? readFileSync(file, "utf8") : "", mtime: fileMtime(file) };
    },
  }),
  command({
    name: "project.setNotes",
    summary:
      "Replace the project notes: writes the project's CLAUDE.md (the team's file, read by Claude). With ifMtime, refused (code conflict) when the file changed on disk since it was read.",
    input: z.object({ text: z.string().describe("The whole new markdown of CLAUDE.md"), ifMtime: IF_MTIME }),
    output: z.object({
      file: z.string().describe("Absolute path of CLAUDE.md"),
      bytes: z.number().describe("Bytes written"),
      mtime: z.number().describe("The new modification time, for the next ifMtime"),
    }),
    mutates: true,
    positional: ["text"],
    async run(ctx, input) {
      const file = notesFile(projectOf(ctx));
      unchangedSince(file, input.ifMtime, "CLAUDE.md");
      writeAtomic(file, input.text);
      return { file, bytes: Buffer.byteLength(input.text, "utf8"), mtime: fileMtime(file) };
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
          reference: RAG_CHOICE.nullable()
            .optional()
            .describe("The team's reference configuration, measured by the benchmark (null removes it)"),
          queryTask: z
            .string()
            .optional()
            .describe("The task sentence of the query instruction ({task}); empty = default"),
          passageMaxChars: z.number().int().min(1000).optional().describe("Cap of a passage returned to Claude"),
          retrieval: retrievalOverride
            .optional()
            .describe(
              "Retrieval settings: candidates, rrfK, bm25Weights, rerank { top, mode, threshold, thresholds }, expand (only the keys given change)",
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
    output: PROJECT_JSON.describe("project.json as written"),
    mutates: true,
    async run(ctx, input) {
      const dir = projectOf(ctx);
      const cur = readProject(dir);
      if (input.labelPrefix !== undefined && (!input.labelPrefix.trim() || /\s/.test(input.labelPrefix)))
        throw new UserError(
          `Not a label prefix: ${JSON.stringify(input.labelPrefix)}.`,
          "Use a non-empty prefix without spaces, e.g. testimus- — an empty one would take the team labels draft, to-fix, validated.",
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
          ...(input.rag?.retrieval ? { retrieval: withRetrieval(cur.rag.retrieval, input.rag.retrieval) } : {}),
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
