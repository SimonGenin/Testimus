import { z } from "zod";
import { ask, listChats, showChat } from "../claude/chat.ts";
import { CONTEXT_IDS, CONVERSATION, DIAGNOSIS, EFFORT, MODEL, NOTE, TOKENS } from "../claude/schemas.ts";
import { command, projectOf } from "../command.ts";

const SOURCE = z.object({
  docId: z.string().describe("The document"),
  anchor: z.string().describe("The section (§…), figure (fig:…) or page (page:…)"),
  quote: z.string().describe("The exact words quoted from doc.md"),
});

const PROBLEM = z.object({
  where: z.string().min(1).max(200).describe("Where the app met it: check:<id>, job:<id>, doc:<id>, test:<id>…"),
  text: z.string().min(1).max(4000).describe("What the app says about it: the error and its own advice"),
});

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
      contexts: CONTEXT_IDS.optional().describe("Saved context ids Claude reads first (default: none)."),
      note: NOTE,
      conversation: CONVERSATION,
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
        note: input.note,
        conversation: input.conversation,
        problem: input.problem,
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
          }),
        )
        .describe("The questions and answers, in order"),
      updatedAt: z.string().describe("When it last changed"),
      problem: PROBLEM.optional().describe("The problem the conversation is about, when it is not the documents"),
    }),
    mutates: false,
    positional: ["chatId"],
    async run(ctx, input) {
      return showChat(projectOf(ctx), input.chatId);
    },
  }),
];
