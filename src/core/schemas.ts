import { z } from "zod";
import { retrievalOverride } from "./rag/schemas.ts";
import { REVIEWS, type Review } from "./types.ts";

// ponytail: the zod shapes several command groups share (a test, its id, its review state) — declared once, so the
// CLI help, the MCP tool and the page read the same words

export const REVIEW = z.enum(REVIEWS as [Review, ...Review[]]);

export const TEST_ID = z
  .string()
  .describe("Test id: the folder under tests/ — a Jira key (LFRPS12-1420) or local-<8hex>");

export const SYNC = z
  .enum(["local", "modified", "synced", "remote-changed"])
  .describe(
    "local: never in Jira · modified: changed here since the last sync · synced: as Jira had it · remote-changed: Jira changed since",
  );

export const FINDING_COUNTS = z.object({
  errors: z.number().describe("Findings of severity error"),
  warnings: z.number().describe("Findings of severity warning"),
  infos: z.number().describe("Findings of severity info"),
  stale: z.boolean().describe("test.md changed since that check ran"),
});

export const TEST_REF = z.object({
  id: z.string().describe("Test id (the folder under tests/)"),
  key: z.string().optional().describe("Jira key, once the test is in Jira"),
  summary: z.string().describe("Test summary"),
  folder: z.string().describe("Xray folder path"),
  labels: z.array(z.string()).describe("Its Jira labels"),
  review: REVIEW.describe("Review state"),
  generated: z
    .boolean()
    .describe("Written by a generation (generated_by set): it waits in review.queue until validated"),
  awaiting: z.boolean().describe("Generated and not validated yet: it waits in the review queue"),
  edited: z.boolean().describe("Generated, and its content changed since the generation wrote it"),
  sync: SYNC,
  dirty: z.boolean().describe("test.md differs from the version Jira had at the last sync (or was never synced)"),
  synced: z.boolean().describe("Pulled from or pushed to Jira at least once (.remote.md exists)"),
  mtime: z.number().describe("test.md modification time (ms, rounded): give it back as ifMtime to tests.save"),
  stepCount: z.number().describe("Number of steps"),
  findings: FINDING_COUNTS.optional().describe("What the last check found, when there was one"),
  generating: z
    .boolean()
    .optional()
    .describe("A running generation is still writing it: listed only with generating: true until it ends"),
});

export const SOURCE = z.object({
  docId: z.string().describe("Document code (docs/<docId>/)"),
  anchor: z.string().describe("Anchor in the document: §5.6.6, fig:<n> or page:<n>"),
  quote: z.string().describe("Short quote copied verbatim from doc.md"),
  column: z.string().optional().describe("The smart column this source backs (written @<column>); none = the step"),
  item: z
    .string()
    .optional()
    .describe('The words of that column\'s cell it backs, e.g. a requirement code (written @<column> "<item>")'),
});

export const STEP = z.object({
  id: z.string().optional().describe("Xray step id, when the step came from Jira"),
  fields: z
    .record(z.string(), z.string())
    .describe("Step fields by Xray name (Action, Data, Expected Result, and the smart columns)"),
  sources: z.array(SOURCE).default([]).describe("Claims the step relies on (local, never pushed)"),
  images: z
    .array(
      z.object({
        file: z.string().describe("The picture, relative to the test folder: images/<file>"),
        remoteId: z.string().optional().describe("Its Xray attachment id, once pushed or pulled"),
        figure: z.string().optional().describe("The document figure the picture was copied from: docId#fig:40"),
      }),
    )
    .default([])
    .describe(
      "Every attachment of the step, embedded or not: images/<file>, its Xray attachment id and the figure it came from",
    ),
});

export const TEST = z.object({
  key: z.string().optional().describe("Jira key; absent for a local test"),
  project: z.string().describe("Jira project key"),
  summary: z.string().describe("Test summary"),
  folder: z.string().describe("Xray folder path"),
  labels: z.array(z.string()).default([]).describe("Jira labels"),
  status: z
    .string()
    .optional()
    .describe("Jira status — a copy of Jira's, never pushed: a save keeps the one on disk (issue.transition moves it)"),
  assignee: z
    .string()
    .optional()
    .describe("Display name of the Jira assignee — a copy, never pushed: a save keeps disk's (issue.assign)"),
  assigneeId: z.string().optional().describe("Jira account id of the assignee — a copy, kept from disk on save"),
  description: z.string().default("").describe("Test description"),
  covers: z.array(z.string()).default([]).describe("Issue keys the test is linked to in Jira (« Test » links)"),
  clonedFrom: z.string().optional().describe("Key of the test this one was cloned from"),
  preconditions: z.array(z.string()).default([]).describe("Precondition issue keys"),
  review: REVIEW.default("draft").describe("Review state — read-only here: a save keeps the one on disk (review.set)"),
  reviewNote: z.string().optional().describe("Reviewer's note (with to-fix) — read-only here, kept from disk"),
  reviewedBy: z.string().optional().describe("Who set the review state — read-only here, kept from disk"),
  reviewedAt: z.string().optional().describe("When the review state was set (ISO) — read-only here, kept from disk"),
  generatedBy: z.string().optional().describe("Job id of the generation that wrote the test — read-only here"),
  steps: z.array(STEP).describe("Steps in order"),
  extra: z
    .record(z.string(), z.string())
    .default({})
    .describe(
      'Unknown frontmatter keys, kept as they are ("#…" keys belong to the parser and are always kept from disk)',
    ),
});

export const IF_MTIME = z
  .number()
  .optional()
  .describe(
    "The file's mtime as the read gave it: the write is refused (code conflict) when the file changed on disk since",
  );

export const COLUMN_SHOW = z
  .enum(["open", "filled", "collapsed", "hidden"])
  .describe(
    "open: on every step · filled: only on a step that holds something · collapsed: folded on every step · hidden: left out unless a step holds text in it",
  );

export const STEP_COLUMN = z.object({
  name: z.string().describe("Column name, as test.md writes it"),
  id: z.string().optional().describe("The Xray step field it follows (a local column that was in Xray keeps it)"),
  origin: z.enum(["xray", "local"]).describe("xray: a step field of Xray, pushed; local: kept in test.md only"),
  builtin: z.boolean().describe("Action, Data or Expected Result"),
  status: z
    .enum(["ok", "new", "gone"])
    .describe("new: added in Xray and never described here; gone: was in Xray, no longer — now local"),
  description: z.string().describe("What Claude writes in it (a smart column); empty = Claude leaves it empty"),
  mode: COLUMN_SHOW,
  referenceSource: z
    .boolean()
    .optional()
    .describe(
      'Reference source: each item of the column (a requirement code…) has a source written @<column> "<item>", and the editor makes the item a link to that passage',
    ),
});

export const XRAY_FIELD = z.object({
  id: z.string().describe("Xray step field id"),
  name: z.string().describe("Its name in Xray"),
  type: z.string().describe("Its Xray type"),
  builtin: z.boolean().describe("Action, Data or Expected Result"),
  required: z.boolean().optional().describe("Xray requires a value"),
  disabled: z.boolean().optional().describe("Switched off in Xray"),
});

export const XRAY_JSON = z.object({
  fetchedAt: z.string().optional().describe("When the step fields were last read from Xray (ISO)"),
  fields: z.array(XRAY_FIELD).describe("Xray's step fields, in Xray's order"),
});

export const RAG_CHOICE = z.union([
  z.object({ pack: z.string().describe("Pack id: light, performance, balanced, quality") }),
  z.object({
    embedding: z.string().describe("Catalog id of the embedding"),
    reranker: z.string().nullable().describe("Catalog id of the reranker, or null"),
  }),
]);

export const PRESET = z.object({
  label: z.string().describe("Button text of the quick ask"),
  prompt: z.string().describe("The request it sends to Claude"),
});

export const OVERVIEW_OPTION = z.object({
  enabled: z
    .boolean()
    .optional()
    .describe("Claude writes docs/OVERVIEW.md and updates it after each import or conversion (off when absent)"),
  inEveryRun: z
    .boolean()
    .optional()
    .describe("Every Claude run is told to read docs/OVERVIEW.md first (only while enabled; off when absent)"),
});

export const VIDEO_OPTIONS = z.object({
  spoken: z
    .array(z.string())
    .optional()
    .describe(
      "Languages expected in the videos, as codes (fr, en, de…): one = heard in it; several = each passage in the one detected among them; none or absent = each passage in the language detected",
    ),
  glossary: z
    .array(z.string())
    .optional()
    .describe(
      "Terms given to the transcription (codes, acronyms, names of equipment), most important first; absent = taken from the documents",
    ),
  density: z
    .enum(["sober", "normal", "detailed"])
    .optional()
    .describe("How many key frames a video gets: sober (half), normal (about 40 a half-hour), detailed (more)"),
  translate: z
    .boolean()
    .optional()
    .describe("Claude translates what is said in another language than the project's (on when absent)"),
});

export const PROJECT_JSON = z.object({
  name: z.string().describe("Display name"),
  jiraProject: z.string().describe("Jira project key"),
  jiraOffline: z.boolean().optional().describe("Work without Jira for now"),
  language: z.string().describe("Language of the generated tests"),
  labelPrefix: z.string().describe("Prefix of the review labels pushed to Jira"),
  folders: z.array(z.string()).describe("Xray repository folders offered when generating"),
  rag: z
    .object({
      claudeHeaders: z.boolean().optional().describe("Claude writes a context header per chunk"),
      describeFigures: z.boolean().optional().describe("Claude describes the figures at conversion"),
      reference: RAG_CHOICE.optional().describe("The team's reference configuration"),
      queryTask: z.string().optional().describe("The task sentence of the query instruction"),
      passageMaxChars: z.number().optional().describe("Cap of a passage returned to Claude"),
      retrieval: retrievalOverride.optional().describe("Retrieval settings"),
    })
    .describe("Retrieval settings of the project"),
  claude: z
    .object({
      model: z.string().describe("Default model alias or name"),
      effort: z.enum(["low", "medium", "high", "xhigh", "max"]).describe("Default effort"),
      presets: z.array(PRESET).describe("Quick asks offered in the dock"),
      contexts: z.array(z.string()).describe("Context ids attached to every run"),
      overview: OVERVIEW_OPTION.optional().describe(
        "How the documents fit together (docs/OVERVIEW.md): off when absent",
      ),
    })
    .describe("Claude defaults"),
  glossary: z.record(z.string(), z.string()).optional().describe("Acronyms and their long forms"),
  video: VIDEO_OPTIONS.optional().describe("How the project's videos are read (defaults when absent)"),
});
