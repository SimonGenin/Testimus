import { z } from "zod";
import { command, UserError } from "../command.ts";
import { cancelJob, clearJobs, listJobs, showJob } from "../jobs.ts";

const STATUS = z.enum(["running", "done", "failed", "cancelled"]).describe("Where the job is");

const step = z.object({
  id: z.string().describe("Stable id of the step"),
  label: z.string().describe("What the step does, in words"),
  status: z.enum(["waiting", "running", "done", "failed", "cancelled", "skipped"]).describe("Where the step is"),
  startedAt: z.string().optional().describe("When it started (ISO)"),
  endedAt: z.string().optional().describe("When it ended (ISO)"),
  done: z.number().optional().describe("Items done"),
  total: z.number().optional().describe("Items in all"),
  message: z.string().optional().describe("Its last progress line"),
  jobId: z.string().optional().describe("The child job that carries this step"),
});

const proc = z.object({
  id: z.string().describe("Stable id of the program run"),
  label: z.string().describe("What it is, in words (a Claude run, a model server)"),
  command: z.string().describe("The command line"),
  pid: z.number().optional().describe("Its process id"),
  step: z.string().optional().describe("The step that started it"),
  startedAt: z.string().describe("When it started (ISO)"),
  endedAt: z.string().optional().describe("When it ended (ISO)"),
  exit: z.number().nullable().optional().describe("Its exit code (null: killed)"),
});

const job = z.object({
  id: z.string().describe("Job id"),
  kind: z.string().describe("What kind of work: the command's job name (generate, rag-index, pull…)"),
  subject: z.string().describe("What it works on, in words"),
  status: STATUS,
  startedAt: z.string().describe("When it started (ISO)"),
  endedAt: z.string().optional().describe("When it ended (ISO)"),
  progress: z
    .object({ done: z.number().describe("Items done"), total: z.number().describe("Items in all") })
    .optional()
    .describe("How far it is"),
  message: z.string().optional().describe("Its last progress line"),
  result: z.unknown().optional().describe("The command's output, as that command's own schema says"),
  error: z.string().optional().describe("Why it failed"),
  fix: z.string().optional().describe("What to do about the error, when the command said"),
  code: z.string().optional().describe("The error's stable name, when the command gave one (e.g. conflict)"),
  pid: z.number().optional().describe("The Testimus process that runs it"),
  parentId: z.string().optional().describe("The job this one runs inside (its parent waits for it)"),
  cause: z
    .object({
      jobId: z.string().describe("The earlier job"),
      why: z.enum(["after-failure", "follow-up", "retry"]).describe("How this one relates to it"),
    })
    .optional()
    .describe("The job this one was started because of: after its failure, as its follow-up, or to run it again"),
  steps: z.array(step).optional().describe("The job's named phases, in order"),
  processes: z.array(proc).optional().describe("Programs the job started on this machine (Claude runs, model servers)"),
  interrupted: z.literal(true).optional().describe("The app stopped while the job ran"),
  rerun: z
    .object({
      name: z.string().describe("The command"),
      input: z.unknown().describe("Its input, as that command's own schema says"),
    })
    .optional()
    .describe("The command and input to run it again"),
});

const base = {
  jobId: z.string().describe("The job the event belongs to"),
  at: z.string().describe("When it happened (ISO)"),
  project: z.string().nullable().optional().describe("The project it happened in (null: the machine's own work)"),
};
const claudeEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().describe("What Claude wrote") }),
  z.object({
    type: z.literal("tool"),
    name: z.string().describe("The tool Claude called"),
    input: z.string().describe("Its input"),
  }),
  z.object({
    type: z.literal("result"),
    ok: z.boolean().describe("The run succeeded"),
    text: z.string().describe("Its last answer"),
    costUsd: z.number().optional().describe("What it cost"),
    tokens: z
      .object({ input: z.number().describe("Tokens read"), output: z.number().describe("Tokens written") })
      .optional()
      .describe("Tokens used"),
    sessionId: z.string().optional().describe("Claude's session id"),
    durationMs: z.number().describe("How long it ran"),
  }),
  z.object({ type: z.literal("stderr"), text: z.string().describe("What claude printed on stderr") }),
]);
const event = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("status"), job: job.describe("The job as it is now") }),
  z.object({
    ...base,
    type: z.literal("progress"),
    message: z.string().describe("The progress line"),
    done: z.number().optional().describe("Items done"),
    total: z.number().optional().describe("Items in all"),
    pull: z
      .looseObject({ key: z.string().describe("The test pulled") })
      .optional()
      .describe("Where a pull is"),
    step: z.string().optional().describe("The step it belongs to"),
  }),
  z.object({
    ...base,
    type: z.literal("log"),
    level: z.enum(["info", "warn", "error"]).describe("How serious"),
    message: z.string().describe("The log line"),
    step: z.string().optional().describe("The step it belongs to"),
  }),
  z.object({
    ...base,
    type: z.literal("claude"),
    event: claudeEvent.describe("What Claude did"),
    step: z.string().optional().describe("The step it belongs to"),
    process: z.string().optional().describe("The Claude run it came from"),
  }),
  z.object({ ...base, type: z.literal("steps"), steps: z.array(step).describe("The job's steps, declared") }),
  z.object({ ...base, type: z.literal("process"), process: proc.describe("A program started or ended") }),
  z.object({ ...base, type: z.literal("changed"), paths: z.array(z.string()).describe("Project files it changed") }),
  z.object({ ...base, type: z.literal("notice"), message: z.string().describe("A notice for every page") }),
]);

const JOB_ID = z.string().describe("Job id");

export const commands = [
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
    input: z.object({ id: JOB_ID }),
    output: z.object({ job, events: z.array(event).describe("The job's log, oldest first") }),
    mutates: false,
    positional: ["id"],
    async run(ctx, input) {
      const j = showJob(ctx.project, input.id);
      if (!j) throw new UserError(`No job ${input.id}.`, "testimus jobs list shows the jobs of the open project.");
      return j;
    },
  }),
  command({
    name: "jobs.cancel",
    summary: "Cancel a running job.",
    input: z.object({ id: JOB_ID }),
    output: z.object({ cancelled: z.boolean().describe("False when the job was not running here") }),
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
