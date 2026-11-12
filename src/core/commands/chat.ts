import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ask, listChats, showChat } from "../claude/chat.ts";
import { LEARN_EFFORT, LEARN_MODEL, learn } from "../claude/learn.ts";
import { CONTEXT_IDS, CONVERSATION, DIAGNOSIS, EFFORT, MODEL, NOTE, TOKENS, WITHOUT } from "../claude/schemas.ts";
import { recordApplied } from "../claude/snapshot.ts";
import { type Ctx, command, projectOf, UserError } from "../command.ts";
import { columnMoved, fileOf, proposalsOf, readProposal, settle } from "../lib/proposals.ts";
import { PROPOSAL } from "../schemas.ts";
import type { Proposal } from "../types.ts";

const SOURCE = z.object({
  docId: z.string().describe("The document"),
  anchor: z.string().describe("The section (§…), figure (fig:…) or page (page:…)"),
  quote: z.string().describe("The exact words quoted from doc.md"),
});

const PROBLEM = z.object({
  where: z.string().min(1).max(200).describe("Where the app met it: check:<id>, job:<id>, doc:<id>, test:<id>…"),
  text: z.string().min(1).max(4000).describe("What the app says about it: the error and its own advice"),
});

const PROPOSAL_ID = z
  .string()
  .regex(/^[\w-]+$/, "A proposal id: prop-<8hex>")
  .describe("Proposal id (prop-<8hex>)");

const bytesOf = (project: string, rel: string | null) => {
  const f = rel ? join(project, ...rel.split("/")) : "";
  return f && existsSync(f) ? readFileSync(f) : null;
};

// ponytail: applying writes through the command that owns the file, against the version the proposal was made on (a
// file that moved since is refused, code conflict); what it changed joins the proposing run's record, so that run's
// Revert takes it back
async function apply(ctx: Ctx, project: string, p: Proposal): Promise<void> {
  const write = ctx.invoke;
  if (!write) throw new Error("chat.apply runs through the registry.");
  if (p.kind === "overview") await write("docs.overviewSave", { text: p.after, ifMtime: p.mtime });
  else if (p.kind === "plan") await write("gen.planSet", { generation: p.target, plan: p.data, ifMtime: p.mtime });
  else if (p.kind === "context") await write("contexts.set", { id: p.target, notes: p.after, ifMtime: p.mtime });
  else {
    if (columnMoved(project, p))
      throw new UserError(
        `The description of ${p.name} changed since Claude proposed this.`,
        "Ask Claude again from the description as it is now.",
        "conflict",
      );
    await write("columns.save", { name: p.target, description: p.after });
  }
}

export const commands = [
  command({
    name: "chat.ask",
    summary:
      'Ask Claude a question about the project\'s documents (the answer cites docId#anchor "quote"), or about a problem the app met (problem).',
    input: z.object({
      question: z.string().min(1).describe("The question, in any language."),
      chatId: z.string().optional().describe("Continue this conversation (from chat.list); omit to start one."),
      model: MODEL.optional().describe("Model alias or name (default: project.json claude.model)."),
      effort: EFFORT.optional().describe("Effort level (default: project.json claude.effort)."),
      contexts: CONTEXT_IDS.optional().describe(
        "Saved context ids for this run, in place of the ones its subject attaches (a test's or a document's own list, else the project's defaults; claude.preview shows them).",
      ),
      without: WITHOUT,
      note: NOTE,
      conversation: CONVERSATION,
      generation: z
        .string()
        .regex(/^[\w.-]+$/)
        .optional()
        .describe(
          "A generation whose plan waits for the user's go on Generate: Claude is given the plan and its questions and may propose a new plan (gen.planPropose)",
        ),
      problem: PROBLEM.optional().describe(
        "A problem the app met (a failed check, an error): Claude explains its cause and what to do, may use what it knows beyond the documents, and may propose a Claude action; the conversation stays about it.",
      ),
    }),
    output: z.object({
      chatId: z.string().describe("The conversation, to continue it"),
      sessionId: z.string().optional().describe("The Claude Code session the conversation resumes"),
      ok: z.boolean().describe("Whether Claude answered"),
      answer: z.string().describe("Claude's answer, or why it failed"),
      sources: z.array(SOURCE).describe("The sources the answer cites"),
      proposals: z
        .array(PROPOSAL)
        .describe(
          "The changes the answer proposes to the overview, a context, a column or a plan: chat.apply or chat.ignore",
        ),
      costUsd: z.number().optional().describe("What the run cost"),
      tokens: TOKENS.optional(),
      diagnosis: DIAGNOSIS.optional(),
      raw: z.string().optional().describe("Claude's raw output (stdout and stderr), for « Show raw output »"),
    }),
    mutates: true,
    job: "chat",
    positional: ["question"],
    subject: (i) => i.question.slice(0, 60),
    async run(ctx, input) {
      return await ask({
        project: projectOf(ctx),
        question: input.question,
        chatId: input.chatId,
        model: input.model,
        effort: input.effort,
        contexts: input.contexts,
        without: input.without,
        note: input.note,
        conversation: input.conversation,
        problem: input.problem,
        generation: input.generation,
        signal: ctx.signal,
        onEvent: (e) => ctx.claude(e),
      });
    },
  }),
  command({
    name: "chat.list",
    summary: "The conversations with the documents, most recent first.",
    input: z.object({}),
    output: z.array(
      z.object({
        id: z.string().describe("Conversation id"),
        title: z.string().describe("Its first question"),
        updatedAt: z.string().describe("When it last changed"),
        turns: z.number().describe("How many questions and answers"),
      }),
    ),
    mutates: false,
    async run(ctx) {
      return listChats(projectOf(ctx));
    },
  }),
  command({
    name: "chat.show",
    summary: "One conversation with all its turns.",
    input: z.object({ chatId: z.string().describe("Conversation id (from chat.list).") }),
    output: z.object({
      id: z.string().describe("Conversation id"),
      sessionId: z.string().optional().describe("The Claude Code session it resumes"),
      title: z.string().describe("Its first question"),
      turns: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]).describe("user = the question, assistant = Claude's answer"),
            text: z.string().describe("What was said"),
            at: z.string().describe("When"),
            runId: z.string().optional().describe("The Claude run that answered"),
            proposals: z
              .array(PROPOSAL)
              .optional()
              .describe("The changes that answer proposed, as they stand (open, applied, ignored)"),
          }),
        )
        .describe("The questions and answers, in order"),
      updatedAt: z.string().describe("When it last changed"),
      problem: PROBLEM.optional().describe("The problem the conversation is about, when it is not the documents"),
    }),
    mutates: false,
    positional: ["chatId"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const chat = showChat(project, input.chatId);
      const runs = chat.turns.flatMap((t) => (t.runId ? [t.runId] : []));
      const all = proposalsOf(project, runs);
      return {
        ...chat,
        turns: chat.turns.map((t) => {
          const own = t.runId ? all.filter((p) => p.runId === t.runId) : [];
          return own.length ? { ...t, proposals: own } : t;
        }),
      };
    },
  }),
  command({
    name: "chat.apply",
    summary:
      "Apply a change Claude proposed in the chat (to the overview, a context or a column) through the command that writes that file — refused (code conflict) when the file changed since. The proposing run's Revert (claude.revert) takes it back.",
    input: z.object({ id: PROPOSAL_ID }),
    output: PROPOSAL,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const p = readProposal(project, input.id);
      if (p.state !== "open")
        throw new UserError(`The proposal for ${p.name} is already ${p.state}.`, "Nothing more to do with it.");
      const rel = fileOf(project, p);
      const before = bytesOf(project, rel);
      await apply(ctx, project, p);
      if (rel) recordApplied(project, p.runId, rel, before);
      return settle(project, p.id, "applied");
    },
  }),
  command({
    name: "chat.ignore",
    summary: "Leave a change Claude proposed in the chat as it is: nothing is written, the proposal is closed.",
    input: z.object({ id: PROPOSAL_ID }),
    output: PROPOSAL,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      return settle(projectOf(ctx), input.id, "ignored");
    },
  }),
  command({
    name: "chat.learn",
    summary: `After a chat turn: a short Claude run (${LEARN_MODEL}, effort ${LEARN_EFFORT} by default) keeps what the last exchange taught in the conversations context (contexts/conversations/context.md) — rewritten whole through contexts.learn, without asking; nothing when it taught nothing. Snapshotted: claude.revert takes it back.`,
    input: z.object({
      chatId: z.string().describe("The conversation (from chat.list): its last question and answer are read"),
      model: MODEL.optional().describe(`Model alias or name (default: ${LEARN_MODEL})`),
      effort: EFFORT.optional().describe(`Effort level (default: ${LEARN_EFFORT})`),
      contexts: CONTEXT_IDS.optional().describe(
        "Saved context ids for this run, in place of the project's defaults (the conversations context itself is always its subject, never its reference)",
      ),
      without: WITHOUT,
    }),
    output: z.object({
      ok: z.boolean().describe("Whether the run finished"),
      learned: z.boolean().describe("Whether the conversations context changed"),
      summary: z.string().describe("Claude's one line: what it kept, or why it failed"),
      runId: z.string().optional().describe("The Claude run, for claude.revert"),
      costUsd: z.number().optional().describe("What the run cost"),
      diagnosis: DIAGNOSIS.optional(),
    }),
    mutates: true,
    job: "learn",
    positional: ["chatId"],
    subject: (i) => i.chatId,
    label: () => "Remember the conversation",
    async run(ctx, input) {
      return await learn({
        project: projectOf(ctx),
        chatId: input.chatId,
        model: input.model,
        effort: input.effort,
        contexts: input.contexts,
        without: input.without,
        signal: ctx.signal,
        jobId: ctx.jobId,
        onEvent: (e) => ctx.claude(e),
      });
    },
  }),
];
