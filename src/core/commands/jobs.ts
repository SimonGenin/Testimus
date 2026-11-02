import { z } from "zod";
import { type Command, command, UserError } from "../command.ts";
import { cancelJob, listJobs, showJob } from "../jobs.ts";

const job = z.object({
  id: z.string(),
  kind: z.string(),
  subject: z.string(),
  status: z.enum(["running", "done", "failed", "cancelled"]),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  progress: z.object({ done: z.number(), total: z.number() }).optional(),
  message: z.string().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  pid: z.number().optional(),
});

export const commands: Command[] = [
  command({
    name: "jobs.list",
    summary: "List the project's jobs, running and past, newest first.",
    input: z.object({ running: z.boolean().optional().describe("Only the jobs still running") }),
    output: z.array(job),
    mutates: false,
    async run(ctx, input) {
      const all = listJobs(ctx.project);
      return input.running ? all.filter((j) => j.status === "running") : all;
    },
  }),
  command({
    name: "jobs.show",
    summary: "Show one job with its log.",
    input: z.object({ id: z.string().describe("Job id") }),
    output: z.object({ job, events: z.array(z.unknown()) }),
    mutates: false,
    positional: ["id"],
    async run(ctx, input) {
      const j = showJob(ctx.project, input.id);
      if (!j) throw new UserError(`No job ${input.id}.`);
      return j;
    },
  }),
  command({
    name: "jobs.cancel",
    summary: "Cancel a running job.",
    input: z.object({ id: z.string().describe("Job id") }),
    output: z.object({ cancelled: z.boolean() }),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      return { cancelled: cancelJob(input.id, ctx.project) };
    },
  }),
];
