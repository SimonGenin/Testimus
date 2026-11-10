import { z } from "zod";
import { listPrompts, previewRun } from "../claude/catalog.ts";
import { draftComment } from "../claude/comment.ts";
import { diagnose } from "../claude/diagnose.ts";
import { scopeDocs } from "../claude/gen-prompt.ts";
import { type Subject, subjectOf } from "../claude/given.ts";
import { readLedger } from "../claude/ledger.ts";
import {
  CONTEXT_IDS,
  CONVERSATION,
  DIAGNOSIS,
  EFFORT,
  MODEL,
  NOTE,
  RESULT,
  SCOPE,
  scopeLabel,
  TOKENS,
  WITHOUT,
} from "../claude/schemas.ts";
import { runOnScope } from "../claude/scoped.ts";
import { leftAsIs, readRun, revert, standingRun } from "../claude/snapshot.ts";
import { CONNECT, checkSignedIn, claudeExe, claudeVersion } from "../claude/status.ts";
import { command, projectOf } from "../command.ts";
import { scopeName, testName } from "../lib/names.ts";
import { readXray } from "../lib/project.ts";
import { parseTest } from "../lib/testfile.ts";
import { TEST, TEST_ID } from "../schemas.ts";

const STATUS = z.object({
  installed: z.boolean().describe("claude --version answered"),
  version: z.string().optional().describe("Its version"),
  exe: z.string().describe("The Claude program Testimus runs (the setting, or the one found on PATH)"),
  signedIn: z.boolean().nullable().describe("Whether a tiny run worked; null when it was not tried (signIn not asked)"),
  detail: z.string().describe("What claude said, first line"),
  diagnosis: DIAGNOSIS.optional(),
  connect: z
    .array(
      z.object({
        title: z.string().describe("The step"),
        cmd: z.string().describe("What to type"),
        hint: z.string().describe("Where and how"),
      }),
    )
    .describe("How to install Claude Code and sign in"),
});

const PIECE = z.object({
  id: z
    .string()
    .describe(
      "Stable id: instruction, skill:<name>, rules, tools, overview, context:<id>, doc:<id>, docnote:<id>, note, conversation — what `without` takes for the ones a run may leave out",
    ),
  kind: z
    .enum([
      "instruction",
      "skill",
      "rules",
      "tools",
      "overview",
      "context",
      "document",
      "docnote",
      "note",
      "conversation",
    ])
    .describe(
      "instruction: what Testimus asks · skill: the method the instruction names · rules: the project's CLAUDE.md · tools: the app's commands the run may call · overview: how the documents fit together · context: a saved context · document: a document Claude may search · docnote: what the team wrote about a document · note, conversation: the user's own words for this run",
    ),
  name: z.string().describe("What it is, in words"),
  why: z.string().describe("Why it is in this request: who attaches it"),
  how: z
    .enum(["inline", "pointer", "auto", "search"])
    .describe(
      "inline: said in full in the prompt · pointer: Claude is told where to read it · auto: Claude Code loads it by itself · search: Claude finds passages in it with the search tools",
    ),
  locked: z.boolean().describe("True when the run cannot go without it: it is shown, never left out"),
  on: z.boolean().describe("Whether it goes with this run"),
  chars: z.number().describe("Its size in characters: the text said, or the file pointed at (0 when it has none)"),
  path: z.string().optional().describe("Its file, relative to the project folder (absolute for a shared context)"),
  parent: z.string().optional().describe("The piece it hangs under: a document's note under its document"),
  detail: z.string().optional().describe("One line more: a context's files and outside paths, a document's version"),
  text: z.string().optional().describe("Its text, when it has one to read"),
});

export const commands = [
  command({
    name: "claude.preview",
    summary:
      "What a Claude run would be given, before it is sent, piece by piece: the instruction (its template), the skill it names, the project rules, the tools of that kind of run, then what goes with it — how the documents fit together, the saved contexts (the ones attached and the others, off), the documents Claude may search and what the team wrote about those the run is about, the note and the conversation. Worked out by the function the run itself calls: what is listed is what is sent.",
    input: z.object({
      use: z
        .string()
        .describe(
          "The prompt the run sends, by its id (claude.prompts): generate, check, analyze, fix, ask-step, ask-test, ask-tests, ask-doc, ask-project, ask-run, chat, chat-problem, comment, columns, action, triage, triage-doc, figures…",
        ),
      scope: SCOPE.optional().describe(
        "What the run is about, as claude.run takes it: its contexts and its documents follow from it (default: nothing in particular — the project's defaults)",
      ),
      docs: z.array(z.string()).optional().describe("A generation: the documents in scope as a whole"),
      sections: z.array(z.string()).optional().describe("A generation: the document sections in scope, docId#§x.y"),
      contexts: CONTEXT_IDS.optional().describe(
        "Saved context ids for this run, in place of the ones its subject attaches",
      ),
      generation: z
        .string()
        .optional()
        .describe(
          "A request on a generation (gen.revise): unless given here, the contexts and the documents in scope are the ones that generation ran with",
        ),
      without: WITHOUT,
      note: NOTE,
      conversation: CONVERSATION,
    }),
    output: z.object({
      use: z.string().describe("The prompt's id"),
      kind: z.string().describe("The kind of run: it decides the tools and what goes with the run"),
      name: z.string().describe("The prompt's name"),
      answers: z.string().describe("What the run gives back, and through what"),
      pieces: z.array(PIECE).describe("Everything the run is given, in the order it is said"),
    }),
    mutates: false,
    positional: ["use"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const ran = input.generation ? readLedger(project, input.generation)?.input : undefined;
      const docs = scopeDocs(input.docs?.length || input.sections?.length ? input : (ran ?? input));
      const subject: Subject = input.scope
        ? subjectOf(input.scope)
        : docs.length
          ? { kind: "project", docs }
          : { kind: "none" };
      return previewRun(project, input.use, subject, { ...input, contexts: input.contexts ?? ran?.contexts });
    },
  }),
  command({
    name: "claude.run",
    summary:
      "Run Claude on a test, a step, several tests or the project; snapshots the tests so the run can be reverted.",
    input: z.object({
      scope: SCOPE.describe(
        "What Claude may edit: { kind: step|test|tests|project, testId?, step?, testIds? }; or what it reads without changing anything: { kind: run, run, testId?, step? } (a test run).",
      ),
      prompt: z.string().describe("The request, e.g. « Rephrase in house style »."),
      model: MODEL.optional().describe("Model alias or name (default: project.json claude.model)."),
      effort: EFFORT.optional().describe("Effort level (default: project.json claude.effort)."),
      contexts: CONTEXT_IDS.optional().describe(
        "Saved context ids for this run, in place of the ones its subject attaches (default: the test's own list, else project.json claude.contexts; on the project, every context the project or a test attaches, once each).",
      ),
      without: WITHOUT,
      note: NOTE,
      conversation: CONVERSATION,
    }),
    output: RESULT,
    mutates: true,
    job: "claude",
    subject: (i) => scopeLabel(i.scope),
    label: (i, project) => scopeName(project, i.scope),
    async run(ctx, input) {
      const project = projectOf(ctx);
      ctx.progress({ message: `Claude on ${scopeName(project, input.scope)}` });
      return await runOnScope(ctx, project, input);
    },
  }),
  command({
    name: "claude.revert",
    summary:
      "Put back the tests a Claude run changed, as they were before it; refuses (naming them) when a test was edited after the run, unless force.",
    input: z.object({
      runId: z.string().describe("The runId returned by claude.run (or gen/review runs)."),
      force: z.boolean().optional().describe("Also discard the edits made to those tests after the run."),
    }),
    output: z.object({
      reverted: z.array(z.string()).describe("Tests put back"),
      files: z
        .array(z.string())
        .describe("Other files put back (project.json, a document's files), relative to the project folder"),
    }),
    mutates: true,
    positional: ["runId"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const reverted = revert(project, input.runId, { force: input.force === true });
      return { reverted, files: readRun(project, input.runId).revertedFiles ?? [] };
    },
  }),
  command({
    name: "claude.before",
    summary:
      "A test as it was before the latest Claude run that changed it, while that change stands (the run finished, was not reverted, and the test was not synced with Jira since); null when there is none.",
    input: z.object({ testId: TEST_ID }),
    output: z
      .object({
        runId: z.string().describe("The run, to revert it with claude.revert"),
        at: z.string().describe("When the run started (ISO)"),
        kind: z.string().optional().describe("What ran: the chat, a fix, an action…"),
        label: z.string().optional().describe("The run's own title, when it has one"),
        steps: z.array(z.number()).describe("The steps the run changed, by number, as it left the test"),
        untouched: z
          .boolean()
          .describe("test.md is still as the run left it: every difference from `test` is the run's"),
        test: TEST.describe("The test as test.md said it before the run"),
      })
      .nullable(),
    mutates: false,
    positional: ["testId"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const found = standingRun(project, input.testId);
      if (!found) return null;
      const { rec, md } = found;
      return {
        runId: rec.runId,
        at: rec.at,
        ...(rec.kind ? { kind: rec.kind } : {}),
        ...(rec.label ? { label: rec.label } : {}),
        steps: rec.changedSteps[input.testId] ?? [],
        untouched: leftAsIs(project, rec, input.testId),
        test: parseTest(
          md,
          readXray(project).fields.map((f) => f.name),
        ).test,
      };
    },
  }),
  command({
    name: "claude.draftComment",
    summary:
      "Claude drafts a comment for a test's Jira issue (it reads the test, the thread and the documents) and gives it back as text — it posts nothing; the person sends it with issue.comment. Mentions are written @[Name](accountId).",
    input: z.object({
      key: z.string().describe("Issue key of the test, e.g. LFRPS12-1420"),
      ask: z.string().default("").describe("What the comment should say (empty: answer the thread)"),
      model: MODEL.optional().describe("Model alias or name (default: project.json claude.model)."),
      effort: EFFORT.optional().describe("Effort level (default: project.json claude.effort)."),
      contexts: CONTEXT_IDS.optional().describe(
        "Saved context ids for this run, in place of the ones its subject attaches (a test's or a document's own list, else the project's defaults; claude.preview shows them).",
      ),
      without: WITHOUT,
    }),
    output: z.object({
      ok: z.boolean().describe("Whether Claude drafted something"),
      text: z.string().describe("The draft, or why it failed"),
      mentions: z
        .array(z.object({ accountId: z.string().describe("Jira account id"), name: z.string().describe("Name") }))
        .describe("The people the draft mentions"),
      costUsd: z.number().optional().describe("What the run cost"),
      tokens: TOKENS.optional(),
      diagnosis: DIAGNOSIS.optional(),
      raw: z.string().optional().describe("Claude's raw output (stdout and stderr), for « Show raw output »"),
    }),
    mutates: true,
    job: "comment-draft",
    positional: ["key"],
    subject: (i) => i.key,
    label: (i, project) => testName(project, i.key),
    async run(ctx, input) {
      return draftComment({
        project: projectOf(ctx),
        key: input.key.trim().toUpperCase(),
        ask: input.ask,
        model: input.model,
        effort: input.effort,
        contexts: input.contexts,
        without: input.without,
        signal: ctx.signal,
        onEvent: (e) => ctx.claude(e),
      });
    },
  }),
  command({
    name: "claude.prompts",
    summary:
      "Everything Claude is given in this project, run by run: the project's skills (the team's too), each prompt Testimus builds (as its template, the parts filled per run in {braces}) with the kind of run that sends it, what goes with it, the tools it has and what it gives back, CLAUDE.md and the contexts attached by default — read only. claude.preview says it for one request.",
    input: z.object({}),
    output: z.array(
      z.object({
        id: z
          .string()
          .describe("Stable id: skill:<name>, file:CLAUDE.md, context:<id>, or the id of a prompt Testimus builds"),
        name: z.string().describe("What it is, in words (« Generate tests »)"),
        group: z
          .string()
          .describe("What it is used for: Generation, Check and fix, Tests, Documents, Chat, Every run, Team skills…"),
        origin: z
          .enum(["skill", "built", "file", "context"])
          .describe(
            "skill: a .claude/skills/<name>/SKILL.md of the project · built: written by Testimus for each run · file: a project file every run reads (CLAUDE.md) · context: a context attached by default",
          ),
        path: z
          .string()
          .optional()
          .describe(
            "Where it is, relative to the project folder (absolute for a shared context); none for a prompt built per run",
          ),
        file: z.string().optional().describe("Its absolute path, for Show in Explorer"),
        usedBy: z.array(z.string()).describe("The screens and commands that send it to Claude"),
        text: z
          .string()
          .describe("The full text; a prompt Testimus builds shows its template, the parts filled per run in {braces}"),
        kind: z
          .string()
          .optional()
          .describe("A built prompt: the kind of run that sends it (none for a sign-in probe)"),
        answers: z.string().optional().describe("A built prompt: what the run gives back, and through what"),
        takes: z
          .object({
            overview: z.boolean().describe("Whether the run is told to read how the documents fit together (when on)"),
            documents: z
              .boolean()
              .describe("Whether the run searches the documents: they are listed, and one can be left out of a run"),
            contexts: z.string().describe("Which saved contexts go with it, as a rule"),
            tools: z.array(z.string()).describe("The app's commands the run may call, as tools"),
            files: z
              .array(z.string())
              .describe("Claude Code's own tools the run has: Read, Edit, Write, Glob, Grep, Skill"),
          })
          .optional()
          .describe("A built prompt: what goes with every run of its kind, whatever the request"),
      }),
    ),
    mutates: false,
    async run(ctx) {
      return listPrompts(projectOf(ctx));
    },
  }),
  command({
    name: "claude.status",
    summary: "Is Claude Code installed (version) and signed in; what to run to connect it.",
    input: z.object({
      signIn: z
        .boolean()
        .optional()
        .describe("Also check the sign-in with a tiny real `claude -p` run (costs a few tokens)."),
      refresh: z.boolean().optional().describe("Ask `claude --version` again instead of the remembered answer."),
    }),
    output: STATUS,
    mutates: false,
    global: true,
    async run(ctx, input) {
      const v = await claudeVersion(input.refresh === true, ctx.signal);
      const base = { exe: claudeExe(), connect: CONNECT };
      if (!v.ok) return { ...base, installed: false, signedIn: false, detail: v.text, diagnosis: diagnose(v.text) };
      const version = v.text.match(/\d+\.\d+\.\d+/)?.[0];
      if (!input.signIn) return { ...base, installed: true, version, signedIn: null, detail: v.text };
      const s = await checkSignedIn(ctx.signal);
      return { ...base, installed: true, version, signedIn: s.signedIn, detail: s.text, diagnosis: s.diagnosis };
    },
  }),
];
