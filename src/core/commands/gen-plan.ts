import { z } from "zod";
import { planText } from "../claude/gen-plan.ts";
import { revisePlan, setPlan, settleForWriting } from "../claude/gen-replan.ts";
import { generateTests } from "../claude/generate.ts";
import { readLedger } from "../claude/ledger.ts";
import { EFFORT, MODEL } from "../claude/schemas.ts";
import { command, projectOf } from "../command.ts";
import { generationName } from "../lib/names.ts";
import { propose } from "../lib/proposals.ts";
import { PROPOSAL, RUN_ID } from "../schemas.ts";
import { GEN_RESULT, PLANNED_TEST, QUESTION } from "./gen-schemas.ts";

const GENERATION = z
  .string()
  .regex(/^[\w.-]+$/, "A generation id")
  .describe("The generation whose plan waits");

const PLAN = z.object({
  tests: z.array(PLANNED_TEST).min(1).describe("The planned tests, in order"),
  questions: z.array(QUESTION).optional().describe("The questions still open (omitted: kept as they are)"),
});

const ANSWERS = z
  .record(z.string(), z.string())
  .default({})
  .describe("Answers to the plan's questions, by question id: a proposed answer or the user's own words");

const PLAN_OUT = z.object({
  tests: z.array(PLANNED_TEST).describe("The planned tests"),
  questions: z.array(QUESTION).describe("The questions still open"),
});

export const commands = [
  command({
    name: "gen.plan",
    summary:
      "Revise the plan of a generation waiting for the user's go (gen.tests with review): Claude resumes the plan's own session with the answers to its questions, the plan as the user left it and what they ask, and answers the whole plan again. As many rounds as wanted; nothing is written. The answers stay in the generation's ledger.",
    input: z.object({
      generation: GENERATION,
      answers: ANSWERS,
      request: z.string().max(20000).default("").describe("What should change in the plan, in words (may be empty)"),
      model: MODEL.optional().describe("Model alias or name (default: the generation's)"),
      effort: EFFORT.optional().describe("Effort level (default: the generation's)"),
    }),
    output: GEN_RESULT,
    mutates: true,
    job: "generate",
    subject: (i) => i.generation,
    label: (i, project) => `Revise the plan « ${generationName(project, i.generation)} »`,
    async run(ctx, input) {
      return await revisePlan(projectOf(ctx), ctx, input);
    },
  }),
  command({
    name: "gen.planSet",
    summary:
      "Edit the plan of a generation waiting for the user's go, without Claude: its tests as the user leaves them (renamed, merged, unticked, moved to another theme) and, when given, its questions. What it left out stays.",
    input: z.object({
      generation: GENERATION,
      plan: PLAN.describe("The whole plan"),
      ifMtime: z
        .number()
        .optional()
        .describe("The ledger's mtime the plan was read at: refused (conflict) when it moved"),
    }),
    output: PLAN_OUT,
    mutates: true,
    positional: ["generation"],
    async run(ctx, input) {
      const p = setPlan(projectOf(ctx), input.generation, input.plan, input.ifMtime);
      return { tests: p.tests, questions: p.questions };
    },
  }),
  command({
    name: "gen.planPropose",
    summary:
      "Propose a new plan for a generation waiting for the user's go, which a chat cannot write: nothing is written — the user sees the change as a diff under the answer and applies it (chat.apply, through gen.planSet) or ignores it.",
    input: z.object({
      runId: RUN_ID,
      generation: GENERATION,
      plan: PLAN.describe("The whole new plan: the current one changed only where the user asked"),
      why: z.string().min(1).max(500).describe("Why, in one sentence, in the language of the conversation"),
    }),
    output: PROPOSAL,
    mutates: true,
    positional: ["generation"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const questions = input.plan.questions ?? readLedger(project, input.generation)?.plan?.questions ?? [];
      const plan = { tests: input.plan.tests, questions };
      return propose(project, {
        kind: "plan",
        target: input.generation,
        after: planText(plan),
        why: input.why,
        runId: input.runId,
        data: plan,
      });
    },
  }),
  command({
    name: "gen.write",
    summary:
      "Write the plan of a generation waiting for the user's go: the answers given settle its questions (kept in its ledger), the unticked tests go, then one run per test as gen.tests writes a plan — each told the questions settled, never asking them again nor leaving a behavior out for them. reindex first when the index is not up to date.",
    input: z.object({
      generation: GENERATION,
      answers: ANSWERS,
      reindex: z
        .boolean()
        .default(false)
        .describe("Reindex the documents first (rag.index) — what changed since the last index is searched then"),
      model: MODEL.optional().describe("Model alias or name (default: the generation's)"),
      effort: EFFORT.optional().describe("Effort level (default: the generation's)"),
    }),
    output: GEN_RESULT,
    mutates: true,
    job: "generate",
    subject: (i) => i.generation,
    label: (i, project) => {
      const l = project ? readLedger(project, i.generation) : null;
      const n = l?.plan?.tests.filter((t) => !t.off).length ?? 0;
      return n
        ? `Generate ${n} test${n === 1 ? "" : "s"}`
        : `Write the plan « ${generationName(project, i.generation)} »`;
    },
    async run(ctx, input) {
      const project = projectOf(ctx);
      settleForWriting(project, input.generation, input.answers);
      // ponytail: what the team settled about the plan is kept for the next runs, like a chat turn — in the background
      if (readLedger(project, input.generation)?.settled?.length)
        void ctx.invoke?.("chat.learn", { generation: input.generation }, { wait: false })?.catch(() => {});
      return await generateTests(
        project,
        {
          request: "",
          resume: input.generation,
          reindex: input.reindex,
          ...(input.model ? { model: input.model } : {}),
          ...(input.effort ? { effort: input.effort } : {}),
        },
        ctx,
      );
    },
  }),
];
