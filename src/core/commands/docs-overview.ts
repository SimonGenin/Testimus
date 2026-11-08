import { z } from "zod";
import type { OverviewResult } from "../claude/overview.ts";
import { EFFORT, MODEL } from "../claude/schemas.ts";
import { command, projectOf } from "../command.ts";
import { unchangedSince } from "../lib/atomic.ts";
import {
  basisOf,
  changesSince,
  OVERVIEW_PATH,
  overviewFile,
  overviewOption,
  readLastUpdate,
  readOverview,
  writeOverview,
} from "../lib/overview.ts";
import { OVERVIEW_JOB, OVERVIEW_LABEL, runOverviewJob } from "../lib/overview-after.ts";
import { IF_MTIME } from "../schemas.ts";

const names = z.array(z.string()).describe("Section titles");
const sectionChanges = z
  .object({ modified: names, added: names, removed: names })
  .describe("The sections an update changed, added and removed");
const docChange = z.object({
  id: z.string().describe("Document id"),
  change: z
    .enum(["added", "converted", "removed"])
    .describe("added, converted (again, or its details changed), removed"),
  title: z.string().describe("Its title (its id once removed)"),
});

export const commands = [
  command({
    name: "docs.overview",
    summary: `Claude writes or updates ${OVERVIEW_PATH}, how the project's documents fit together (skill overview-documents). auto: only the sections of the documents added, converted again or removed since the last update, and the sections across them; the rest is kept word for word (checked after the run: a warning says what Claude changed anyway). full: rewritten from scratch. Waits for the imports, the index run and the generations of the project. Refused while the option is off (project.json claude.overview.enabled).`,
    input: z.object({
      mode: z
        .enum(["auto", "full"])
        .default("auto")
        .describe("auto: update what changed since the last update (default) · full: rewrite it whole"),
      model: MODEL.optional().describe("Model of the run (default: the project's)"),
      effort: EFFORT.optional().describe("Effort of the run (default medium)"),
    }),
    output: z.object({
      ran: z.boolean().describe("False when nothing had changed since the last update (no Claude run)"),
      mode: z.enum(["auto", "full"]).describe("What was done: full when there was no overview yet"),
      changes: z.array(docChange).describe("The documents added, converted again or removed since the last update"),
      sections: sectionChanges,
      warnings: z.array(z.string()).describe("Sections Claude changed though their document did not, and the like"),
      summary: z.string().describe("Claude's last words"),
      runId: z.string().optional().describe("The Claude run's id"),
    }),
    mutates: true,
    job: OVERVIEW_JOB,
    subject: (i) => i.mode,
    label: () => OVERVIEW_LABEL,
    run: (ctx, input): Promise<OverviewResult> => runOverviewJob(ctx, projectOf(ctx), input),
  }),
  command({
    name: "docs.overviewShow",
    summary: `How the documents fit together: the text of ${OVERVIEW_PATH} (without its frontmatter), when and after what it was last updated, what that update changed, the documents changed since, and whether the option is on.`,
    input: z.object({}),
    output: z.object({
      enabled: z.boolean().describe("Claude writes it and updates it after each import (project.json)"),
      inEveryRun: z.boolean().describe("Every Claude run is told to read it first"),
      exists: z.boolean().describe(`Whether ${OVERVIEW_PATH} is there`),
      path: z.string().describe("Its path in the project"),
      text: z.string().describe("Its markdown, without the frontmatter"),
      mtime: z.number().describe("Its modification time (ms, rounded; 0 when missing): docs.overviewSave ifMtime"),
      updatedAt: z.string().optional().describe("When Claude last wrote it (ISO)"),
      updatedAfter: z.string().optional().describe("What that update came after (« Import of 3 documents »)"),
      changed: sectionChanges,
      pending: z.array(docChange).describe("Documents added, converted again or removed since the last update"),
      last: z
        .object({
          at: z.string().describe("When"),
          before: z.string().describe("The text before the last update"),
          after: z.string().describe("The text Claude left"),
        })
        .nullable()
        .describe("The last update on this PC, for « Show changes » (null when another PC made it)"),
    }),
    mutates: false,
    async run(ctx) {
      const project = projectOf(ctx);
      const o = readOverview(project);
      const option = overviewOption(project);
      return {
        ...option,
        exists: o.exists,
        path: OVERVIEW_PATH,
        text: o.body,
        mtime: o.mtime,
        ...(o.meta.updatedAt ? { updatedAt: o.meta.updatedAt } : {}),
        ...(o.meta.updatedAfter ? { updatedAfter: o.meta.updatedAfter } : {}),
        changed: { modified: o.meta.modified ?? [], added: o.meta.added ?? [], removed: o.meta.removed ?? [] },
        pending: o.exists ? changesSince(project, o.meta.basis, basisOf(project)) : [],
        last: o.exists ? readLastUpdate(project) : null,
      };
    },
  }),
  command({
    name: "docs.overviewSave",
    summary: `Replace the text of ${OVERVIEW_PATH} by hand (its frontmatter is kept). With ifMtime, refused (code conflict) when the file changed on disk since it was read. The next update merges into it.`,
    input: z.object({
      text: z.string().describe("The whole new markdown, without the frontmatter"),
      ifMtime: IF_MTIME,
    }),
    output: z.object({
      mtime: z.number().describe("The new modification time, for the next ifMtime"),
    }),
    mutates: true,
    positional: ["text"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      unchangedSince(overviewFile(project), input.ifMtime, OVERVIEW_PATH);
      writeOverview(project, readOverview(project).meta, input.text);
      return { mtime: readOverview(project).mtime };
    },
  }),
];
