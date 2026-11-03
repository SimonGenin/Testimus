import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { z } from "zod";
import { type Command, type Ctx, command, projectOf, UserError } from "../command.ts";
import { env } from "../env.ts";
import { loadCorpus, runMechanical } from "../lib/check.ts";
import { followXray, stepColumns } from "../lib/columns.ts";
import { type CsvTest, csvTests, guessMapping, parseCsv } from "../lib/csv.ts";
import {
  browseUrl,
  bulkImportStatus,
  bulkTestJson,
  getFolderTree,
  getStepFields,
  listPreconditions,
  listTests,
  reviewLabels,
  searchTests,
  startBulkImport,
} from "../lib/jira.ts";
import { fieldOrder, readProject, readXray, writeProject, writeXray } from "../lib/project.ts";
import { createLocalTest, listLocalTests, localTestRef } from "../lib/store.ts";
import {
  checkRemote,
  connectJira,
  disconnectJira,
  executePlan,
  type Push,
  planView,
  projectInfo,
  pullToLocal,
  pushTest,
} from "../lib/sync.ts";
import { REVIEWS, type Review, type Test } from "../types.ts";

const id = z.string().describe("Test id: the folder under tests/ — a Jira key (LFRPS12-1420) or local-<8hex>");
const review = z.enum(REVIEWS as [Review, ...Review[]]);
const field = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  builtin: z.boolean(),
  required: z.boolean().optional().describe("Xray requires a value on every step"),
  disabled: z.boolean().optional().describe("Switched off in Xray's project settings (kept, shown « off in Xray »)"),
});
const xrayJson = z.object({
  fields: z.array(field),
  prefs: z.object({
    order: z.array(z.string()),
    collapsed: z.array(z.string()),
    hidden: z.array(z.string()),
    filled: z.array(z.string()).optional(),
    open: z.array(z.string()).optional(),
  }),
  fetchedAt: z.string().optional(),
  columns: z
    .array(
      z.object({
        name: z.string(),
        id: z.string().optional(),
        description: z.string().optional(),
        referenceSource: z.boolean().optional(),
      }),
    )
    .optional(),
});
const remoteRef = z.object({
  key: z.string(),
  issueId: z.string(),
  summary: z.string(),
  status: z.string(),
  labels: z.array(z.string()),
  folder: z.string(),
  stepCount: z.number(),
});
const planOp = z.object({
  label: z.string(),
  kind: z.enum(["create", "update", "upload", "embed", "label", "link", "folder", "other"]),
});
const planSchema = z.object({
  testId: z.string(),
  key: z.string().optional(),
  ops: z.array(planOp),
  warnings: z.array(z.string()),
  remoteChanged: z.boolean(),
  review,
  planHash: z.string().describe("Hash of these ops and of the test file — xray.push takes it to run exactly this plan"),
});
const opResult = z.object({
  label: z.string(),
  status: z.enum(["done", "failed", "not-started"]),
  error: z.string().optional(),
});
const syncEnum = z.enum(["local", "modified", "synced", "remote-changed"]);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ponytail: the plan a failed push was executing, kept per test so "resume from op k" runs the same ops
// the user saw — a rebuilt plan would already have dropped the ops that went through
const unfinished = new Map<string, Push>();

// ponytail: one push of a test at a time in this process — two at once (two tabs, UI + Claude) would
// both run the create op and leave two Jira tests
const pushing = new Set<string>();

type PushInput = { id: string; dryRun: boolean; planHash?: string; overwriteRemote: boolean; from?: number };
type OpResult = z.infer<typeof opResult>;

async function push(ctx: Ctx, project: string, slot: string, input: PushInput) {
  const kept = input.from !== undefined ? unfinished.get(slot) : undefined;
  if (input.from !== undefined && !kept)
    ctx.log("info", "No stopped push of this test in memory — the plan is rebuilt and run from its first op.");
  const p = kept ?? (await pushTest(project, input.id));
  const plan = planView(p);
  const ops: OpResult[] = p.plan.ops.map((o, i) => ({
    label: o.label,
    status: kept && i < (input.from ?? 0) ? "done" : "not-started",
  }));
  if (input.dryRun) return { ok: true, id: input.id, plan, ops };
  if (input.planHash !== p.hash)
    throw new UserError(
      "The test or Jira changed since you saw the plan — nothing was pushed.",
      `Look at the new plan (xray.plan ${input.id}) and push with its planHash.`,
    );
  if (p.plan.remoteChanged && !input.overwriteRemote)
    throw new UserError(
      `${p.local.key ?? input.id} was changed in Jira since your last sync — pushing would replace that change.`,
      "Pull it from Jira first, or push with overwriteRemote to replace the Jira version.",
    );
  const from = kept ? (input.from ?? 0) : 0;
  const total = p.plan.ops.length;
  const r = await executePlan(
    project,
    p,
    (i, state) => {
      if (state === "running") ctx.progress({ message: p.plan.ops[i].label, done: i, total });
      if (state === "done") ops[i].status = "done";
      if (state === "failed") ops[i].status = "failed";
    },
    from,
    ctx.signal,
  );
  const cancelled = r.cancelled ?? false;
  const view = { ...plan, warnings: [...p.plan.warnings] };
  if (!r.ok) {
    unfinished.set(slot, p);
    const at = r.failedAt ?? 0;
    if (r.cancelled === undefined) ops[at].error = message(r.error);
    ctx.log(
      r.cancelled === undefined ? "error" : "warn",
      r.cancelled === undefined ? `Stopped at operation ${at + 1} of ${total}: ${message(r.error)}` : message(r.error),
    );
    return { ok: false, id: r.id, plan: view, ops, failedAt: r.failedAt, error: message(r.error), cancelled };
  }
  unfinished.delete(slot);
  ctx.progress({ message: "pushed", done: total, total });
  if (r.error) ctx.log("warn", `Pushed, but the refresh from Jira failed: ${message(r.error)}`);
  return {
    ok: true,
    id: r.id,
    plan: view,
    ops,
    cancelled,
    ...(r.error ? { error: `Pushed; refreshing from Jira failed — ${message(r.error)}` } : {}),
  };
}

async function allInFolder(projectId: string, folder: string, descendants: boolean): Promise<string[]> {
  const keys: string[] = [];
  for (let page = 0; ; page++) {
    const { tests, total } = await listTests(projectId, { folder, descendants }, page);
    keys.push(...tests.map((t) => t.key));
    if (!tests.length || keys.length >= total) return keys;
  }
}

function csvInput(input: { file?: string; text?: string; name?: string }): { text: string; name: string } {
  if (input.text !== undefined) return { text: input.text, name: input.name || "Imported test" };
  if (!input.file) throw new UserError("Nothing to import.", "Give a CSV file path (--file) or its text (--text).");
  const path = resolve(input.file);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new UserError(`Cannot read ${path}.`, "Check the path of the CSV file.");
  }
  return { text, name: input.name || basename(path, extname(path)) };
}

function testOfCsv(project: string, t: CsvTest): Test {
  return {
    project,
    summary: t.summary,
    folder: t.folder,
    labels: t.labels,
    description: t.description,
    covers: [],
    preconditions: [],
    review: "draft",
    steps: t.steps.map((s) => ({ fields: s.fields, sources: [], images: [] })),
    extra: {},
  };
}

// ponytail: Xray's bulk import is asynchronous; two minutes of polling, then the job id goes back to the
// caller, who resumes with it — importing the CSV a second time would create every test twice
export const importPoll = { tries: 120, everyMs: 1000 };

type ImportOut = {
  headers: string[];
  mapping: Record<string, string>;
  tests: unknown[];
  warnings: string[];
  written: string[];
};
type PlanOp = z.infer<typeof planOp>;

const importPlan = (n: number, key: string): PlanOp[] => [
  { label: `Import ${n} test${n > 1 ? "s" : ""} into ${key} (Xray bulk import)`, kind: "create" },
  { label: "Pull the created tests", kind: "other" },
];

async function finishImport(ctx: Ctx, project: string, jobId: string, out: ImportOut, plan: PlanOp[]) {
  const finished = (s: string) => /^(successful|failed|partially_successful)$/.test(s);
  let status = await bulkImportStatus(jobId);
  for (let i = 0; i < importPoll.tries && !finished(status.status); i++) {
    if (ctx.signal.aborted)
      throw new UserError(
        `Import cancelled while Xray was still importing (job ${jobId}).`,
        `Run the import again with jobId ${jobId} to pick up the tests it creates — not with the CSV, that would import them twice.`,
      );
    await new Promise((r) => setTimeout(r, importPoll.everyMs));
    status = await bulkImportStatus(jobId);
  }
  if (!finished(status.status)) {
    const note = `Xray is still importing (job ${jobId}, ${status.status}) — run the import again with jobId ${jobId} to pull the created tests; do not import the CSV again.`;
    ctx.log("warn", note);
    return { ...out, warnings: [...out.warnings, note], plan, jobId };
  }
  out.warnings.push(...status.errors.map((e) => `Xray import error: ${e}`), ...status.warnings);
  if (status.status === "failed" || !status.issues.length)
    throw new UserError(`Xray bulk import ${status.status}: ${status.errors.join("; ") || "no test created"}.`);
  ctx.progress({ message: "Pull the created tests", done: 1, total: 2 });
  for (const issue of status.issues) {
    try {
      out.written.push(await pullToLocal(project, issue.key, { signal: ctx.signal }));
    } catch (e) {
      out.warnings.push(`${issue.key} was created but could not be pulled: ${message(e)}`);
    }
  }
  return { ...out, plan };
}

export const commands: Command[] = [
  command({
    name: "xray.fields",
    summary: "Fetch the project's Xray step fields (built-in and custom) into xray.json; local field prefs are kept.",
    input: z.object({}),
    output: xrayJson,
    mutates: true,
    async run(ctx) {
      const project = projectOf(ctx);
      const info = await projectInfo(project);
      const fields = await getStepFields(info.id);
      const next = { ...followXray(readXray(project), fields), fetchedAt: env.now().toISOString() };
      writeXray(project, next);
      return next;
    },
  }),

  command({
    name: "xray.prefs",
    summary: "Set the local step-field preferences in xray.json: display order, folded fields, hidden fields.",
    input: z.object({
      order: z.array(z.string()).optional().describe("Field names in display order (replaces the order)"),
      collapsed: z.array(z.string()).optional().describe("Field names shown folded (replaces the list)"),
      filled: z
        .array(z.string())
        .optional()
        .describe("Field names shown only on a step that holds something in them (replaces the list)"),
      hidden: z.array(z.string()).optional().describe("Field names not shown (replaces the list)"),
      open: z
        .array(z.string())
        .optional()
        .describe(
          "Fields switched off in Xray shown open anyway (they fold unless filled by default; replaces the list)",
        ),
    }),
    output: xrayJson,
    mutates: true,
    async run(ctx, input) {
      const project = projectOf(ctx);
      const x = readXray(project);
      const names = stepColumns(project, x).map((c) => c.name);
      const unknown = [
        ...(input.order ?? []),
        ...(input.collapsed ?? []),
        ...(input.hidden ?? []),
        ...(input.filled ?? []),
        ...(input.open ?? []),
      ].filter((n) => !names.includes(n));
      if (unknown.length)
        throw new UserError(
          `Not a step field of this project: ${[...new Set(unknown)].join(", ")}.`,
          `Known fields: ${names.join(", ")} (testimus xray fields refreshes them).`,
        );
      const next = {
        ...x,
        prefs: {
          order: input.order ?? x.prefs.order,
          collapsed: input.collapsed ?? x.prefs.collapsed,
          hidden: input.hidden ?? x.prefs.hidden,
          filled: input.filled ?? x.prefs.filled ?? [],
          ...((input.open ?? x.prefs.open)?.length ? { open: input.open ?? x.prefs.open } : {}),
        },
      };
      next.prefs.order = fieldOrder(next);
      writeXray(project, next);
      return next;
    },
  }),

  command({
    name: "xray.connect",
    summary:
      "Connect the project to a Jira project: checks the key in Jira (it needs an Xray Test issue type), saves it in project.json and ends a disconnection. Without a key, reconnects the key already set.",
    input: z.object({
      key: z.string().optional().describe("Jira project key, e.g. LFRPS12 (default: the key already in project.json)"),
    }),
    output: z.object({ jiraProject: z.string(), name: z.string().describe("The Jira project's name") }),
    mutates: true,
    positional: ["key"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const key = (input.key ?? readProject(project).jiraProject).trim().toUpperCase();
      if (!key) throw new UserError("Which Jira project?", "Give its key, e.g. testimus xray connect LFRPS12.");
      if (!/^[A-Z][A-Z0-9_]*$/.test(key))
        throw new UserError(`"${key}" is not a Jira project key.`, "A key is letters and digits, e.g. LFRPS12.");
      const info = await connectJira(project, key);
      return { jiraProject: info.key, name: info.name };
    },
  }),

  command({
    name: "xray.disconnect",
    summary:
      "Work locally only: nothing reads or writes Jira for this project until xray.connect (the key is kept, local tests stay as they are).",
    input: z.object({}),
    output: z.object({ jiraProject: z.string() }),
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
    output: z.unknown(),
    mutates: false,
    async run(ctx, input) {
      const info = await projectInfo(projectOf(ctx));
      return getFolderTree(info.id, input.path || "/");
    },
  }),

  command({
    name: "xray.search",
    summary:
      "Find remote tests in Jira: by text in the summary or an issue key, or the tests of a folder (pages of 100).",
    input: z.object({
      text: z.string().optional().describe("Words of the summary, an issue key (LFRPS12-1420) or its number (1420)"),
      folder: z.string().optional().describe("Xray folder to list when no text is given (default: /)"),
      descendants: z.boolean().default(false).describe("With folder: include the sub-folders"),
      page: z.number().int().min(0).default(0).describe("With folder: page number, 100 tests per page"),
    }),
    output: z.object({ tests: z.array(remoteRef), total: z.number() }),
    mutates: false,
    async run(ctx, input) {
      const project = projectOf(ctx);
      const info = await projectInfo(project);
      if (input.text?.trim()) {
        const tests = await searchTests(info.id, input.text, info.key);
        return { tests, total: tests.length };
      }
      return listTests(info.id, { folder: input.folder || "/", descendants: input.descendants }, input.page);
    },
  }),

  command({
    name: "xray.preconditions",
    summary:
      "The project's Xray Preconditions (key, summary, definition), sorted by key — what a test can attach (test.md frontmatter preconditions).",
    input: z.object({}),
    output: z.array(z.object({ key: z.string(), issueId: z.string(), summary: z.string(), definition: z.string() })),
    mutates: false,
    async run(ctx) {
      const info = await projectInfo(projectOf(ctx));
      return listPreconditions(info.id);
    },
  }),

  command({
    name: "xray.browse",
    summary: "The Jira page of an issue (<site>/browse/<KEY>), to open it in the browser. No network.",
    input: z.object({ key: z.string().describe("Issue key, e.g. LFRPS12-1420") }),
    output: z.object({ url: z.string() }),
    mutates: false,
    positional: ["key"],
    async run(_ctx, input) {
      if (!/^[A-Za-z][A-Za-z0-9]*-[0-9]+$/.test(input.key.trim()))
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
      pulled: z.array(z.string()),
      skipped: z.array(z.object({ key: z.string(), reason: z.string() })),
      failed: z.array(z.object({ key: z.string(), error: z.string() })),
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
      "Sync state of one or every local test against Jira: re-checks Jira for the tests that were synced (no image download).",
    input: z.object({ id: id.optional().describe("One test id; every test of the project when absent") }),
    output: z.object({
      tests: z.array(
        z.object({
          id: z.string(),
          key: z.string().optional(),
          sync: syncEnum,
          remote: z.enum(["unchanged", "remote-changed", "unverified"]),
        }),
      ),
    }),
    mutates: false,
    async run(ctx, input) {
      const project = projectOf(ctx);
      const one = input.id ? localTestRef(project, input.id) : null;
      if (input.id && !one)
        throw new UserError(`No test ${input.id} in this project.`, "testimus tests list shows them.");
      const refs = one ? [one] : listLocalTests(project);
      const tests = await Promise.all(
        refs.map(async (r) => {
          const remote = r.key && r.synced ? await checkRemote(project, r.id) : ("unverified" as const);
          const now = localTestRef(project, r.id) ?? r;
          return { id: r.id, ...(r.key ? { key: r.key } : {}), sync: now.sync, remote };
        }),
      );
      return { tests };
    },
  }),

  command({
    name: "xray.plan",
    summary:
      "What a push of one test would do in Jira (re-reads Jira, writes nothing): ops, warnings and the planHash xray.push needs.",
    input: z.object({ id }),
    output: planSchema,
    mutates: false,
    async run(ctx, input) {
      return planView(await pushTest(projectOf(ctx), input.id));
    },
  }),

  command({
    name: "xray.push",
    summary:
      "Push one test to Jira: runs the plan the user confirmed (planHash from xray.plan) op by op and stops at the first failure or a cancel. dryRun returns the plan only; from resumes a stopped push at that op.",
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
      ok: z.boolean(),
      id: z.string().describe("The test id after the push — the new Jira key when the test was created"),
      plan: planSchema,
      ops: z.array(opResult),
      failedAt: z.number().optional(),
      error: z.string().optional(),
      cancelled: z
        .boolean()
        .optional()
        .describe("A cancel stopped the push and nothing ran after it (false: an op in flight finished after it)"),
    }),
    mutates: true,
    job: "push",
    subject: (i) => i.id,
    async run(ctx, input) {
      const project = projectOf(ctx);
      const slot = `${resolve(project)}|${input.id}`;
      if (!input.dryRun) {
        if (!input.planHash)
          throw new UserError(
            "A push runs only the plan you looked at — no planHash given.",
            `Run xray.plan for ${input.id} (or push with dryRun), check its ops, then push with its planHash.`,
          );
        if (pushing.has(slot))
          throw new UserError(
            `A push of ${input.id} is already running.`,
            "Wait for it to finish (Jobs shows it), then look at the new plan.",
          );
        pushing.add(slot);
      }
      try {
        return await push(ctx, project, slot, input);
      } finally {
        if (!input.dryRun) pushing.delete(slot);
      }
    },
  }),

  command({
    name: "xray.importCsv",
    summary:
      "Import a CSV of test steps: preview (parse only), local (write local-* draft tests, the default) or direct (Xray bulk import, then pull). The column mapping is saved in project.json.",
    input: z.object({
      mode: z
        .enum(["preview", "local", "direct"])
        .default("local")
        .describe(
          "preview = parse and return the tests; local = write local draft tests; direct = create them in Jira",
        ),
      file: z.string().optional().describe("Path of the CSV file"),
      text: z.string().optional().describe("The CSV text itself (instead of file)"),
      name: z
        .string()
        .optional()
        .describe("Summary of the tests when the CSV has no summary column (default: file name)"),
      mapping: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "Column → target: a step field name (Action, Expected Result, a smart column…) or #step, #summary, #description, #folder, #labels, #ignore. Unmapped columns are guessed.",
        ),
      folder: z.string().optional().describe("Xray folder of the imported tests when the CSV has no folder column"),
      dryRun: z
        .boolean()
        .default(false)
        .describe("Return what would be written (and, for direct, the plan) without writing"),
      jobId: z
        .string()
        .optional()
        .describe(
          "Direct mode: the Xray import job id a previous call returned when Xray was still importing — waits for it and pulls its tests instead of importing again",
        ),
    }),
    output: z.object({
      headers: z.array(z.string()),
      mapping: z.record(z.string(), z.string()),
      tests: z.array(z.unknown()),
      warnings: z.array(z.string()),
      written: z.array(z.string()),
      plan: z.array(planOp).optional(),
      jobId: z
        .string()
        .optional()
        .describe("Direct mode: the Xray import job still running — call again with it to pick up its tests"),
    }),
    mutates: true,
    subject: (i) => i.file ?? i.name ?? "csv",
    async run(ctx, input) {
      const project = projectOf(ctx);
      const settings = readProject(project);
      const x = readXray(project);
      const names = x.fields.map((f) => f.name);
      if (input.jobId) {
        const resumed = { headers: [], mapping: settings.csvMapping ?? {}, tests: [], warnings: [], written: [] };
        return finishImport(ctx, project, input.jobId, resumed, importPlan(0, settings.jiraProject).slice(1));
      }
      const { text, name } = csvInput(input);
      const table = parseCsv(text);
      if (!table.headers.length) throw new UserError("The CSV is empty.", "Check the file: it needs a header row.");
      const guessed = guessMapping(table.headers, names);
      const saved = Object.fromEntries(
        Object.entries(settings.csvMapping ?? {}).filter(([h]) => table.headers.includes(h)),
      );
      const mapping = { ...guessed, ...saved, ...(input.mapping ?? {}) };
      const parsed = csvTests(table, mapping, { name, folder: input.folder ?? "", fieldNames: names });
      const tests = parsed.tests.map((t) => ({ ...t, steps: t.steps.map((s) => ({ fields: s.fields })) }));
      const out = { headers: table.headers, mapping, tests, warnings: parsed.warnings, written: [] as string[] };
      if (input.mode === "preview") return out;

      const ok = parsed.tests.filter((t) => t.steps.length);
      if (input.mode === "local") {
        if (input.dryRun) return out;
        const order = fieldOrder(x);
        for (const t of ok) out.written.push(createLocalTest(project, testOfCsv(settings.jiraProject, t), order));
        const corpus = loadCorpus(project);
        for (const w of out.written) runMechanical(project, w, corpus);
        writeProject(project, { ...settings, csvMapping: mapping });
        return out;
      }

      const info = await projectInfo(project);
      const plan = importPlan(ok.length, info.key);
      if (input.dryRun) return { ...out, plan };
      const bulk = ok.map((t) => {
        const test = testOfCsv(settings.jiraProject, t);
        return bulkTestJson(
          { ...test, labels: reviewLabels(test.labels, "draft", settings.labelPrefix) },
          info,
          x.fields,
        );
      });
      ctx.progress({ message: plan[0].label, done: 0, total: 2 });
      const jobId = await startBulkImport(bulk);
      writeProject(project, { ...settings, csvMapping: mapping });
      return finishImport(ctx, project, jobId, out, plan);
    },
  }),
];
