import { resolve } from "node:path";
import { z } from "zod";
import { type Ctx, command, projectOf, UserError } from "../command.ts";
import { env } from "../env.ts";
import { storeXray } from "../lib/columns.ts";
import { browseUrl, getFolderTree, getStepFields, listPreconditions, listTests, searchTests } from "../lib/jira.ts";
import { readProject } from "../lib/project.ts";
import { listLocalTests, localTestRef } from "../lib/store.ts";
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
import { REVIEWS, type Review } from "../types.ts";

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
  fetchedAt: z.string().optional().describe("When the fields were read from Xray"),
  fields: z.array(field).describe("Xray's step fields, built-in and custom, in Xray's order"),
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

export const commands = [
  command({
    name: "xray.fields",
    summary:
      "Fetch the project's Xray step fields (built-in and custom) into xray.json; the team's columns (columns.json) follow a field renamed or dropped in Xray.",
    input: z.object({}),
    output: xrayJson,
    mutates: true,
    async run(ctx) {
      const project = projectOf(ctx);
      const info = await projectInfo(project);
      const fields = await getStepFields(info.id);
      return storeXray(project, fields, env.now().toISOString());
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
];
