import { z } from "zod";
import { ask, listChats, showChat } from "../claude/chat.ts";
import { type Command, command, projectOf } from "../command.ts";
import { CONTEXT_IDS, CONVERSATION, EFFORT, MODEL, NOTE } from "./claude.ts";

const SOURCE = z.object({ docId: z.string(), anchor: z.string(), quote: z.string() });

export const commands: Command[] = [
  command({
    name: "chat.ask",
    summary: 'Ask Claude a question about the project\'s documents; the answer cites docId#anchor "quote".',
    input: z.object({
      question: z.string().min(1).describe("The question, in any language."),
      chatId: z.string().optional().describe("Continue this conversation (from chat.list); omit to start one."),
      model: MODEL.optional().describe("Model alias or name (default: project.json claude.model)."),
      effort: EFFORT.optional().describe("Effort level (default: project.json claude.effort)."),
      contexts: CONTEXT_IDS.optional().describe("Saved context ids Claude reads first (default: none)."),
      note: NOTE,
      conversation: CONVERSATION,
    }),
    output: z.object({
      chatId: z.string(),
      sessionId: z.string().optional(),
      ok: z.boolean(),
      answer: z.string(),
      sources: z.array(SOURCE),
      costUsd: z.number().optional(),
      tokens: z
        .object({ input: z.number(), output: z.number() })
        .optional()
        .describe("Tokens the run used (input incl. cache)"),
      diagnosis: z.object({ kind: z.string(), title: z.string(), detail: z.string() }).optional(),
    }),
    mutates: false,
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
        signal: ctx.signal,
        onEvent: (e) => ctx.claude(e),
      });
    },
  }),
  command({
    name: "chat.list",
    summary: "The conversations with the documents, most recent first.",
    input: z.object({}),
    output: z.array(z.object({ id: z.string(), title: z.string(), updatedAt: z.string(), turns: z.number() })),
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
      id: z.string(),
      sessionId: z.string().optional(),
      title: z.string(),
      turns: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string(), at: z.string() })),
      updatedAt: z.string(),
    }),
    mutates: false,
    positional: ["chatId"],
    async run(ctx, input) {
      return showChat(projectOf(ctx), input.chatId);
    },
  }),
];
