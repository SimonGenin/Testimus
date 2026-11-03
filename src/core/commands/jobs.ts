import { z } from "zod";
import { type Command, command, UserError } from "../command.ts";
import { cancelJob, clearJobs, listJobs, showJob } from "../jobs.ts";

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
  fix: z.string().optional().describe("What to do about the error, when the command said"),
  pid: z.number().optional(),
  parentId: z.string().optional().describe("The job this one runs inside (its parent waits for it)"),
  cause: z
    .object({ jobId: z.string(), why: z.enum(["after-failure", "follow-up", "retry"]) })
    .optional()
    .describe("The job this one was started because of: after its failure, as its follow-up, or to run it again"),
  steps: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        status: z.enum(["waiting", "running", "done", "failed", "cancelled", "skipped"]),
        startedAt: z.string().optional(),
        endedAt: z.string().optional(),
        done: z.number().optional(),
        total: z.number().optional(),
        message: z.string().optional(),
        jobId: z.string().optional().describe("The child job that carries this step"),
      }),
    )
    .optional()
    .describe("The job's named phases, in order"),
  processes: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        command: z.string(),
        pid: z.number().optional(),
        step: z.string().optional(),
        startedAt: z.string(),
        endedAt: z.string().optional(),
        exit: z.number().nullable().optional(),
      }),
    )
    .optional()
    .describe("Programs the job started on this machine (Claude runs, model servers)"),
  interrupted: z.literal(true).optional().describe("The app stopped while the job ran"),
  rerun: z
    .object({ name: z.string(), input: z.unknown() })
    .optional()
    .describe("The command and input to run it again"),
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
  command({
    name: "jobs.clear",
    summary: "Forget finished jobs (done, failed, cancelled) and delete their logs; running jobs are kept.",
    input: z.object({
      ids: z.array(z.string()).optional().describe("Only these jobs (default: every finished job)"),
    }),
    output: z.object({ cleared: z.number().describe("Jobs forgotten") }),
    mutates: true,
    async run(ctx, input) {
      return { cleared: clearJobs(ctx.project, input.ids) };
    },
  }),
];
