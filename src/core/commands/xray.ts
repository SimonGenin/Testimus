import { z } from "zod";
import { throwIfAborted } from "../../shared/run/work.ts";
import { command, projectOf, UserError } from "../command.ts";
import { browseUrl, withSignal } from "../lib/jira/http.ts";
import {
  allInFolder,
  getFolderTree,
  ISSUE_KEY,
  listPreconditions,
  listTests,
  PAGE,
  searchTests,
} from "../lib/jira/read.ts";
import { readProject, readXray } from "../lib/project.ts";
import { listLocalTests, localTestRef } from "../lib/store.ts";
import { connectJira, disconnectJira, projectInfo, refreshFields } from "../lib/sync/connect.ts";
import { checkRemote, pullToLocal } from "../lib/sync/pull.ts";
import { planView, pushTest, runPush } from "../lib/sync/push.ts";
import { type Folder, type LocalTestRef, REVIEWS, type Review } from "../types.ts";

const id = z.string().describe("Test id: the folder under tests/ — a Jira key (LFRPS12-1420) or local-<8hex>");
const review = z.enum(REVIEWS as [Review, ...Review[]]).describe("The test's review state (test.md review:)");
const field = z.object({
  id: z.string().describe("Xray's id of the field (action, data, result for the built-in three)"),
  name: z.string().describe("The field's name, as test.md writes it (### <name>)"),
  type: z.string().describe("Xray's field type (text, text-single, toggle, multi-select…)"),
  builtin: z.boolean().describe("One of Action, Data, Expected Result"),
  required: z.boolean().optional().describe("Xray requires a value on every step"),
  disabled: z
    .boolean()
    .optional()
    .describe("Switched off in Xray's project settings (kept in test.md, never pushed, shown « off in Xray »)"),
});
const xrayJson = z.object({
  fetchedAt: z.string().optional().describe("When the fields were read from Xray (absent: never read)"),
  fields: z.array(field).describe("Xray's step fields, built-in and custom, in Xray's order"),
});
const folder: z.ZodType<Folder> = z.object({
  name: z.string().describe("The folder's name (/ for the root)"),
  path: z.string().describe("Its full path, e.g. /Traction/Sectionneurs"),
  testsCount: z.number().describe("Tests directly in this folder"),
  totalCount: z.number().describe("Tests in this folder and all its sub-folders"),
  get folders() {
    return z.array(folder).describe("Its sub-folders, sorted by path");
  },
});
const remoteRef = z.object({
  key: z.string().describe("Issue key, e.g. LFRPS12-1420"),
  issueId: z.string().describe("Jira's numeric issue id"),
  summary: z.string().describe("The test's summary"),
  status: z.string().describe("Jira workflow status (To Do, In Progress…)"),
  labels: z.array(z.string()).describe("Jira labels, the review label included"),
  folder: z.string().describe("Xray folder path"),
  stepCount: z.number().describe("Number of steps in Xray"),
});
const planOp = z.object({
  label: z.string().describe("What this operation does, in words"),
  kind: z
    .enum(["create", "update", "upload", "embed", "label", "link", "folder", "other"])
    .describe("The kind of Jira write"),
});
const planSchema = z.object({
  testId: z.string().describe("The test id the plan was built for"),
  key: z.string().optional().describe("Its Jira key (absent: the push creates the test)"),
  ops: z.array(planOp).describe("The Jira writes, in the order they run"),
  warnings: z.array(z.string()).describe("What the user should know before pushing"),
  remoteChanged: z.boolean().describe("Jira changed since the last sync — pushing replaces that change"),
  review,
  planHash: z.string().describe("Hash of these ops and of the test file — xray.push takes it to run exactly this plan"),
});
const opResult = z.object({
  label: z.string().describe("The operation, as in the plan"),
  status: z.enum(["done", "failed", "not-started"]).describe("What happened to it"),
  error: z.string().optional().describe("Why Jira refused it"),
});
const statusRow = z.object({
  id: z.string().describe("Test id"),
  key: z.string().optional().describe("Jira key (absent: never pushed)"),
  sync: z
    .enum(["local", "modified", "synced", "remote-changed"])
    .describe("local: never pushed; modified: unpushed changes; synced: same as Jira; remote-changed: Jira moved"),
  remote: z
    .enum(["unchanged", "remote-changed", "unverified"])
    .describe("What Jira said now (unverified: not asked — never synced, disconnected, or Jira unreachable)"),
});
const statusOut = z.object({ tests: z.array(statusRow).describe("One row per test") });

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function statusOf(project: string, r: LocalTestRef) {
  const remote = r.key && r.synced ? await checkRemote(project, r.id) : ("unverified" as const);
  const now = localTestRef(project, r.id) ?? r;
  return { id: r.id, ...(r.key ? { key: r.key } : {}), sync: now.sync, remote };
}

export const commands = [
  command({
    name: "xray.fields",
    summary:
      "The project's Xray step fields as last read (xray.json), without asking Xray; xray.refreshFields reads them again.",
    input: z.object({}),
    output: xrayJson,
    mutates: false,
    async run(ctx) {
      return readXray(projectOf(ctx));
    },
  }),

  command({
    name: "xray.refreshFields",
    summary:
      "Read the project's Xray step fields (built-in and custom) again from Xray into xray.json; the team's columns (columns.json) follow a field renamed or dropped in Xray.",
    input: z.object({}),
    output: xrayJson,
    mutates: true,
    async run(ctx) {
      return withSignal(ctx.signal, () => refreshFields(projectOf(ctx)));
    },
  }),

  command({
    name: "xray.connect",
    summary:
      "Connect the project to a Jira project: checks the key in Jira (it needs an Xray Test issue type), saves it in project.json and ends a disconnection. Without a key, reconnects the key already set.",
    input: z.object({
      key: z.string().optional().describe("Jira project key, e.g. LFRPS12 (default: the key already in project.json)"),
    }),
    output: z.object({
      jiraProject: z.string().describe("The Jira project key now saved in project.json"),
      name: z.string().describe("The Jira project's name"),
    }),
    mutates: true,
    positional: ["key"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const key = (input.key ?? readProject(project).jiraProject).trim().toUpperCase();
      if (!key) throw new UserError("Which Jira project?", "Give its key, e.g. testimus xray connect LFRPS12.");
      if (!/^[A-Z][A-Z0-9_]*$/.test(key))
        throw new UserError(`"${key}" is not a Jira project key.`, "A key is letters and digits, e.g. LFRPS12.");
      const info = await withSignal(ctx.signal, () => connectJira(project, key));
      return { jiraProject: info.key, name: info.name };
    },
  }),

  command({
    name: "xray.disconnect",
    summary:
      "Work locally only: nothing reads or writes Jira for this project until xray.connect (the key is kept, local tests stay as they are).",
    input: z.object({}),
    output: z.object({ jiraProject: z.string().describe("The key kept in project.json, unused until xray.connect") }),
    mutates: true,
    async run(ctx) {
      const project = projectOf(ctx);
      disconnectJira(project);
      return { jiraProject: readProject(project).jiraProject };
    },
  }),

  command({
    name: "xray.folders",
    summary: "The project's Xray folder tree (direct and total test counts).",
    input: z.object({ path: z.string().optional().describe("Folder to start from (default: / — the whole tree)") }),
    output: folder,
    mutates: false,
    async run(ctx, input) {
      return withSignal(ctx.signal, async () => {
        const info = await projectInfo(projectOf(ctx));
        return getFolderTree(info.id, input.path || "/");
      });
    },
  }),

  command({
    name: "xray.search",
    summary: `Find remote tests in Jira: by text in the summary or an issue key, or the tests of a folder (pages of ${PAGE}).`,
    input: z.object({
      text: z.string().optional().describe("Words of the summary, an issue key (LFRPS12-1420) or its number (1420)"),
      folder: z.string().optional().describe("Xray folder to list when no text is given (default: /)"),
      descendants: z.boolean().default(false).describe("With folder: include the sub-folders"),
      page: z.number().int().min(0).default(0).describe(`With folder: page number, ${PAGE} tests per page`),
    }),
    output: z.object({
      tests: z.array(remoteRef).describe("The tests found (one page when listing a folder)"),
      total: z.number().describe("How many tests match in all"),
    }),
    mutates: false,
    async run(ctx, input) {
      return withSignal(ctx.signal, async () => {
        const info = await projectInfo(projectOf(ctx));
        if (input.text?.trim()) {
          const tests = await searchTests(info.id, input.text, info.key);
          return { tests, total: tests.length };
        }
        return listTests(info.id, { folder: input.folder || "/", descendants: input.descendants }, input.page);
      });
    },
  }),

  command({
    name: "xray.preconditions",
    summary:
      "The project's Xray Preconditions (key, summary, definition), sorted by key — what a test can attach (test.md frontmatter preconditions).",
    input: z.object({}),
    output: z
      .array(
        z.object({
          key: z.string().describe("Issue key of the precondition"),
          issueId: z.string().describe("Jira's numeric issue id"),
          summary: z.string().describe("Its summary"),
          definition: z.string().describe("Its definition text"),
        }),
      )
      .describe("Every precondition of the project, sorted by key"),
    mutates: false,
    async run(ctx) {
      return withSignal(ctx.signal, async () => {
        const info = await projectInfo(projectOf(ctx));
        return listPreconditions(info.id);
      });
    },
  }),

  command({
    name: "xray.browse",
    summary: "The Jira page of an issue (<site>/browse/<KEY>), to open it in the browser. No network.",
    input: z.object({ key: z.string().describe("Issue key, e.g. LFRPS12-1420") }),
    output: z.object({ url: z.string().describe("The issue's page on the Jira site") }),
    mutates: false,
    positional: ["key"],
    async run(_ctx, input) {
      if (!ISSUE_KEY.test(input.key.trim()))
        throw new UserError(`"${input.key}" is not an issue key.`, "Write it like LFRPS12-1420.");
      return { url: browseUrl(input.key.trim().toUpperCase()) };
    },
  }),

  command({
    name: "xray.pull",
    summary:
      "Download tests from Jira into tests/<KEY>/ (test.md, .remote.md, images): one key, a list, or a whole folder. A locally modified copy is skipped unless overwrite.",
    input: z.object({
      key: z.string().optional().describe("One issue key to pull"),
      keys: z.array(z.string()).optional().describe("Several issue keys to pull"),
      folder: z.string().optional().describe("Pull every test of this Xray folder"),
      descendants: z.boolean().default(true).describe("With folder: include the sub-folders"),
      overwrite: z.boolean().default(false).describe("Replace a local copy that has unpushed changes"),
    }),
    output: z.object({
      pulled: z.array(z.string()).describe("Keys written to tests/, sorted"),
      skipped: z
        .array(
          z.object({
            key: z.string().describe("Issue key"),
            reason: z.string().describe("Why it was left as it is"),
          }),
        )
        .describe("Local copies kept because they hold unpushed or never-synced work"),
      failed: z
        .array(z.object({ key: z.string().describe("Issue key"), error: z.string().describe("What went wrong") }))
        .describe("Keys that could not be pulled"),
    }),
    mutates: true,
    job: "pull",
    subject: (i) => i.key ?? (i.keys?.length ? i.keys.join(", ") : (i.folder ?? "")),
    async run(ctx, input) {
      const project = projectOf(ctx);
      const keys = [...(input.key ? [input.key] : []), ...(input.keys ?? [])];
      if (input.folder) {
        ctx.progress({ message: `listing ${input.folder}` });
        const info = await projectInfo(project);
        keys.push(...(await allInFolder(info.id, input.folder, input.descendants)));
      }
      const unique = [...new Set(keys.map((k) => k.trim().toUpperCase()).filter(Boolean))];
      if (!unique.length) throw new UserError("Nothing to pull.", "Give a key, a list of keys or a folder.");
      const pulled: string[] = [];
      const skipped: Array<{ key: string; reason: string }> = [];
      const failed: Array<{ key: string; error: string }> = [];
      let done = 0;
      ctx.progress({
        message: `${unique.length} test${unique.length > 1 ? "s" : ""} to pull`,
        done,
        total: unique.length,
      });
      await Promise.all(
        unique.map(async (key) => {
          const ref = (() => {
            try {
              return localTestRef(project, key);
            } catch {
              return null;
            }
          })();
          if (ref?.synced && ref.dirty && !input.overwrite) {
            skipped.push({ key, reason: "local copy has unpushed changes (pull with overwrite to replace it)" });
          } else if (ref && !ref.synced && !input.overwrite) {
            skipped.push({ key, reason: "local copy was never synced (pull with overwrite to replace it)" });
          } else {
            try {
              await pullToLocal(project, key, {
                signal: ctx.signal,
                report: (m, stage) =>
                  ctx.progress({ message: `${key}: ${m}`, done, total: unique.length, pull: { key, ...stage } }),
              });
              pulled.push(key);
            } catch (e) {
              if (ctx.signal.aborted) throw e;
              failed.push({ key, error: message(e) });
              ctx.log("warn", `${key}: ${message(e)}`);
            }
          }
          done++;
          ctx.progress({ message: `${key} done`, done, total: unique.length });
        }),
      );
      const byKey = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
      return {
        pulled: pulled.sort(byKey),
        skipped: skipped.sort((a, b) => byKey(a.key, b.key)),
        failed: failed.sort((a, b) => byKey(a.key, b.key)),
      };
    },
  }),

  command({
    name: "xray.status",
    summary:
      "Sync state of one local test against Jira: re-checks Jira when the test was synced (no image download). xray.statusAll checks every test.",
    input: z.object({ id }),
    output: statusOut,
    mutates: false,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const one = localTestRef(project, input.id);
      if (!one)
        throw new UserError(`No test ${input.id} in this project.`, "testimus tests list shows them.", "not-found");
      const row = await withSignal(ctx.signal, () => statusOf(project, one));
      throwIfAborted(ctx.signal);
      return { tests: [row] };
    },
  }),

  command({
    name: "xray.statusAll",
    summary:
      "Sync state of every local test against Jira (job): re-checks Jira for each test that was synced, one request per test, cancellable.",
    input: z.object({}),
    output: statusOut,
    mutates: false,
    job: "status",
    subject: () => "every test",
    async run(ctx) {
      const project = projectOf(ctx);
      const refs = listLocalTests(project);
      let done = 0;
      ctx.progress({ message: `${refs.length} tests to check`, done, total: refs.length });
      const tests = await Promise.all(
        refs.map(async (r) => {
          const row = await statusOf(project, r);
          ctx.progress({ message: `${r.id}: ${row.remote}`, done: ++done, total: refs.length });
          return row;
        }),
      );
      throwIfAborted(ctx.signal);
      return { tests };
    },
  }),

  command({
    name: "xray.plan",
    summary:
      "What a push of one test would do in Jira (re-reads Jira, writes nothing): ops, warnings and the planHash xray.push needs. The same plan as xray.push --dry-run, as a read a Claude run may call (it may not call xray.push).",
    input: z.object({ id }),
    output: planSchema,
    mutates: false,
    positional: ["id"],
    async run(ctx, input) {
      return planView(await withSignal(ctx.signal, () => pushTest(projectOf(ctx), input.id)));
    },
  }),

  command({
    name: "xray.push",
    summary:
      "Push one test to Jira (job). dryRun returns the plan — ops, warnings and its planHash — and writes nothing; without dryRun, runs the plan the user confirmed (that planHash) op by op and stops at the first failure or a cancel; from resumes a stopped push at that op.",
    input: z.object({
      id,
      dryRun: z.boolean().default(false).describe("Return the plan (and its planHash) without writing anything"),
      planHash: z
        .string()
        .optional()
        .describe(
          "planHash of the plan the user looked at (xray.plan or a dry run) — required to write; the push refuses when the plan changed since",
        ),
      overwriteRemote: z
        .boolean()
        .default(false)
        .describe("Push a test that was changed in Jira since the last sync, replacing that change (explicit choice)"),
      from: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Resume the push that stopped, from this op index (failedAt of the previous result)"),
    }),
    output: z.object({
      ok: z.boolean().describe("Every op ran (a dry run: the plan was built)"),
      id: z.string().describe("The test id after the push — the new Jira key when the test was created"),
      plan: planSchema.describe("The plan run, or to run"),
      ops: z.array(opResult).describe("Each op of the plan and what happened to it"),
      failedAt: z.number().optional().describe("Index of the op that failed or was not started after a cancel"),
      error: z.string().optional().describe("Why the push stopped, or why the refresh after it failed"),
      cancelled: z
        .boolean()
        .optional()
        .describe("A cancel stopped the push and nothing ran after it (false: an op in flight finished after it)"),
    }),
    mutates: true,
    job: "push",
    subject: (i) => (i.dryRun ? `${i.id} (plan only)` : i.id),
    async run(ctx, input) {
      return runPush(ctx, projectOf(ctx), input);
    },
  }),
];
