import { z } from "zod";
import { command, projectOf } from "../command.ts";
import { importRun } from "../lib/run-import.ts";
import { exportRun } from "../lib/run-pages.ts";
import { RUN } from "./runs-schemas.ts";

const SIDE = z.object({
  status: z.string().describe("Its result there"),
  updatedAt: z.string().optional().describe("When it was recorded (ISO)"),
  updatedBy: z.string().optional().describe("Who recorded it"),
});

export const commands = [
  command({
    name: "runs.export",
    summary:
      "Export a test run as pages: a new folder anyone opens in a browser on any PC, without Testimus — index.html (the run, no network), run.json, the results so far, the tests' pictures, a small Node server (serve.mjs, 127.0.0.1 only) with start.cmd / start.sh, and a README. Bring it back with runs.import.",
    input: z.object({
      run: RUN,
      dir: z.string().describe("The folder to create: an absolute path, new or empty"),
      results: z.boolean().optional().describe("Include the results already entered (default true)"),
    }),
    output: z.object({
      run: z.string().describe("The run exported"),
      dir: z.string().describe("The folder written"),
      files: z.number().describe("Files written"),
      tests: z.number().describe("Tests in the run"),
      results: z.number().describe("Results included"),
    }),
    mutates: true,
    positional: ["run", "dir"],
    subject: (i) => `${i.run} → ${i.dir}`,
    run: async (ctx, input) => exportRun(projectOf(ctx), input),
  }),

  command({
    name: "runs.import",
    summary:
      "Bring back the results of a run played as pages (the exported folder, or the run.json the page saved): the plan first with dryRun (how many results, comments, questions, screenshots; the conflicts), then the writing. When a test has a result here and another in the pages, the newer wins and the older is kept in its history. A run the project does not have is created from the pages; pages of another run of the same name (made at another time) are refused.",
    input: z.object({
      dir: z.string().optional().describe("The folder of the pages (absolute path)"),
      file: z.string().optional().describe("Or the run.json the page saved (absolute path)"),
      run: RUN.optional().describe("The run to import into (default: the one the pages were exported from)"),
      dryRun: z.boolean().optional().describe("Only say what the import would do; nothing is written"),
    }),
    output: z.object({
      run: z.string().describe("The run the results go to"),
      name: z.string().describe("Its name"),
      source: z.string().describe("The run.json read"),
      creates: z.boolean().describe("The project has no such run: it is made from the pages"),
      dryRun: z.boolean().describe("Nothing was written"),
      tests: z.number().describe("Tests in the run"),
      results: z.number().describe("Tests whose result comes from the pages"),
      comments: z.number().describe("New comments"),
      questions: z.number().describe("New questions"),
      answers: z.number().describe("Questions answered in the pages"),
      attachments: z.number().describe("New screenshots"),
      conflicts: z
        .array(
          z.object({
            test: z.string().describe("The test"),
            summary: z.string().describe("Its summary"),
            kept: z.enum(["pages", "here"]).describe("Which result wins: the newer"),
            here: SIDE.describe("The result in the project"),
            pages: SIDE.describe("The result in the pages"),
          }),
        )
        .describe("Tests with a different result on both sides (a version already in a result's history is settled)"),
      stepsChanged: z
        .array(
          z.object({
            test: z.string().describe("The test"),
            summary: z.string().describe("Its summary"),
            here: z.number().describe("Its steps in the project's run"),
            pages: z.number().describe("Its steps in the pages"),
          }),
        )
        .describe(
          "Tests whose number of steps differs between the pages and the project: their marks are not imported (a step's number no longer says which step it is), their result and comments are",
        ),
    }),
    mutates: true,
    subject: (i) => i.dir ?? i.file ?? "",
    run: async (ctx, input) => importRun(projectOf(ctx), input),
  }),
];
