import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { attachedContexts } from "../claude/given.ts";
import { readTestContexts, writeTestContexts } from "../claude/prompt.ts";
import { command, projectOf, UserError } from "../command.ts";
import { unchangedSince } from "../lib/atomic.ts";
import {
  addContextFile,
  contextFolder,
  copyContext,
  createContext,
  LEARN_MAX,
  learnConversations,
  listContexts,
  otherProject,
  removeContextFile,
  setContext,
  shareContext,
  showContext,
} from "../lib/contexts.ts";
import { readProject } from "../lib/project.ts";
import { propose } from "../lib/proposals.ts";
import { testExists } from "../lib/store.ts";
import { IF_MTIME, PROPOSAL, RUN_ID } from "../schemas.ts";

const ID = z.string().regex(/^[\w-]+$/, "A context id: letters, digits, _ and -");
const id = ID.describe("Context id: the folder under contexts/ (ctx-<8hex>)");
const testId = z.string().describe("Test id: the folder under tests/ — a Jira key or local-<8hex>");

const summary = z.object({
  id: z.string().describe("Context id"),
  name: z.string().describe("Name shown in the UI and in Claude's prompt"),
  paths: z.array(z.string()).describe("Folders or files outside the project Claude may read in place"),
  files: z.array(z.string()).describe("Files copied into contexts/<id>/files/"),
  hasNotes: z.boolean().describe("context.md has notes"),
  shared: z.boolean().describe("In the shared library every project sees, not in this project's contexts/"),
});
const detail = summary.extend({
  notes: z.string().describe("The notes: the body of contexts/<id>/context.md"),
  mtime: z.number().describe("context.md modification time (ms, rounded): contexts.set ifMtime"),
});
const PATHS =
  "Folders or files Claude may read in place, absolute or relative to the project folder (replaces the list)";

const ofTest = (project: string, testId: string) =>
  attachedContexts(project, { kind: "test", testId }).map((a) => a.id);

function mustHaveTest(project: string, test: string): void {
  if (!testExists(project, test))
    throw new UserError(`No test ${test} in this project.`, "testimus tests list shows the tests.");
}

export const commands = [
  command({
    name: "contexts.list",
    summary:
      "List the contexts this project sees — its own and the shared library's: reference bundles (notes, copied files, outside paths) Claude reads before it works.",
    input: z.object({
      from: z
        .string()
        .optional()
        .describe("Another project folder to list its own contexts instead (to pick one for contexts copy)"),
    }),
    output: z.array(summary),
    mutates: false,
    async run(ctx, input) {
      const project = projectOf(ctx);
      return input.from ? listContexts(otherProject(input.from, project), false) : listContexts(project);
    },
  }),
  command({
    name: "contexts.show",
    summary: "Show one context: its name, notes, outside paths and copied files.",
    input: z.object({ id }),
    output: detail,
    mutates: false,
    positional: ["id"],
    async run(ctx, input) {
      return showContext(projectOf(ctx), input.id);
    },
  }),
  command({
    name: "contexts.create",
    summary:
      "Create a context (contexts/ctx-<8hex>/, or in the shared library with --shared), empty or with its notes and outside paths — « Save as context » is one call.",
    input: z.object({
      name: z.string().optional().describe("Name shown in the UI and in Claude's prompt (default: New context)"),
      shared: z
        .boolean()
        .optional()
        .describe("Put it in the shared library every project sees (default: this project)"),
      notes: z.string().optional().describe("Its notes, the body of context.md (default: none)"),
      paths: z.array(z.string()).optional().describe(PATHS),
    }),
    output: detail,
    mutates: true,
    async run(ctx, input) {
      return createContext(projectOf(ctx), input);
    },
  }),
  command({
    name: "contexts.copy",
    summary:
      "Copy a context from another project into this one (notes, outside paths and files); a taken id gets a new one.",
    input: z.object({
      from: z.string().describe("The other project's folder (testimus project list)"),
      id: ID.describe("The context id in that project"),
    }),
    output: detail,
    mutates: true,
    positional: ["from", "id"],
    async run(ctx, input) {
      return copyContext(projectOf(ctx), input.from, input.id);
    },
  }),
  command({
    name: "contexts.share",
    summary:
      "Move a context into the shared library every project sees (shared: true), or back into this project only (false).",
    input: z.object({
      id,
      shared: z.boolean().describe("true: every project sees it; false: only this project keeps it"),
    }),
    output: detail,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      return shareContext(projectOf(ctx), input.id, input.shared);
    },
  }),
  command({
    name: "contexts.set",
    summary:
      "Change a context (contexts/<id>/context.md): its name, its notes or its list of outside paths. With ifMtime, refused (code conflict) when context.md changed on disk since it was read.",
    input: z.object({
      id,
      name: z.string().optional().describe("New name"),
      notes: z.string().optional().describe("New notes, the body of context.md (markdown, may be empty)"),
      paths: z.array(z.string()).optional().describe(PATHS),
      ifMtime: IF_MTIME,
    }),
    output: detail,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      unchangedSince(join(contextFolder(project, input.id), "context.md"), input.ifMtime, `Context ${input.id}`);
      return setContext(project, input.id, input);
    },
  }),
  command({
    name: "contexts.propose",
    summary:
      "Propose new notes for a saved context, which a chat cannot write: nothing is written — the user sees the change as a diff under the answer and applies it (chat.apply) or ignores it.",
    input: z.object({
      runId: RUN_ID,
      id,
      notes: z.string().describe("The whole new notes (markdown): the current ones with what the user asked changed"),
      why: z.string().min(1).max(500).describe("Why, in one sentence, in the language of the conversation"),
    }),
    output: PROPOSAL,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      return propose(projectOf(ctx), {
        kind: "context",
        target: input.id,
        after: input.notes,
        why: input.why,
        runId: input.runId,
      });
    },
  }),
  command({
    name: "contexts.learn",
    summary: `Rewrite the conversations context (contexts/conversations/context.md, created and attached to the project's defaults the first time) with what the chat taught: the whole text, at most ${LEARN_MAX} characters, no source of the documents (docId#anchor), no dates. The one write of the learning run after a chat turn.`,
    input: z.object({
      text: z
        .string()
        .describe(
          `The whole new notes: what holds now — decisions, writing preferences, repeated corrections, vocabulary, settled questions; at most ${LEARN_MAX} characters`,
        ),
    }),
    output: detail,
    mutates: true,
    positional: ["text"],
    async run(ctx, input) {
      return learnConversations(projectOf(ctx), input.text);
    },
  }),
  command({
    name: "contexts.addFile",
    summary: "Copy a file into a context (contexts/<id>/files/): an absolute path, or an upload as base64 from the UI.",
    input: z.object({
      id,
      file: z.string().optional().describe("Absolute path of the file to copy"),
      name: z.string().optional().describe("File name of the upload (with dataBase64)"),
      dataBase64: z.string().optional().describe("The uploaded file, base64"),
    }),
    output: detail.extend({ added: z.string().describe("Name of the copy under files/") }),
    mutates: true,
    positional: ["id", "file"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const added = await addContextFile(project, input.id, input, ctx.signal);
      return { ...showContext(project, input.id), added };
    },
  }),
  command({
    name: "contexts.removeFile",
    summary: "Delete one copied file of a context.",
    input: z.object({ id, name: z.string().describe("File name under files/") }),
    output: detail,
    mutates: true,
    positional: ["id", "name"],
    async run(ctx, input) {
      return removeContextFile(projectOf(ctx), input.id, input.name);
    },
  }),
  command({
    name: "contexts.remove",
    summary:
      "Delete a context folder (a shared one for every project); tests and project defaults that named it simply stop attaching it (outside paths are not touched).",
    input: z.object({ id }),
    output: z.object({
      id: z.string().describe("The context id"),
      removed: z.boolean().describe("The folder is gone"),
    }),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      rmSync(contextFolder(projectOf(ctx), input.id), { recursive: true, force: true });
      return { id: input.id, removed: true };
    },
  }),
  command({
    name: "contexts.ofTest",
    summary:
      "The contexts attached to a test: its own list (tests/<id>/local.json contexts) when it has one, else the project's defaults.",
    input: z.object({ testId }),
    output: z.object({
      effective: z.array(z.string()).describe("Context ids a run on this test attaches (existing ones only)"),
      own: z.array(z.string()).nullable().describe("The test's own list, null when it follows the project"),
      project: z.array(z.string()).describe("The project's default contexts (project.json claude.contexts)"),
    }),
    mutates: false,
    positional: ["testId"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      mustHaveTest(project, input.testId);
      return {
        effective: ofTest(project, input.testId),
        own: readTestContexts(project, input.testId),
        project: readProject(project).claude.contexts,
      };
    },
  }),
  command({
    name: "contexts.ofProject",
    summary:
      "The contexts a request on the whole project attaches: the project's defaults and every test's own list, each once.",
    input: z.object({}),
    output: z.object({
      effective: z.array(z.string()).describe("Context ids a run on the project attaches (existing ones only)"),
    }),
    mutates: false,
    async run(ctx) {
      return { effective: attachedContexts(projectOf(ctx), { kind: "project" }).map((a) => a.id) };
    },
  }),
  command({
    name: "contexts.setTest",
    summary:
      "Set the full list of contexts of one test (tests/<id>/local.json; [] = none); null goes back to the project's defaults.",
    input: z.object({
      testId,
      contexts: z.array(ID).nullable().describe("Context ids for this test, or null to follow the project"),
    }),
    output: z.object({
      effective: z.array(z.string()).describe("Context ids a run on this test attaches (existing ones only)"),
      own: z.array(z.string()).nullable().describe("The test's own list, null when it follows the project"),
    }),
    mutates: true,
    positional: ["testId"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      mustHaveTest(project, input.testId);
      writeTestContexts(project, input.testId, input.contexts);
      return { effective: ofTest(project, input.testId), own: readTestContexts(project, input.testId) };
    },
  }),
];
