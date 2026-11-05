import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { scope } from "../../../shared/run/work.ts";
import { type Ctx, UserError } from "../../command.ts";
import type { PushOpResult, PushPlanView, Test } from "../../types.ts";
import { fieldOrder } from "../columns.ts";
import { sha256 } from "../hash.ts";
import { getMyself } from "../jira/http.ts";
import { type PushPlan, planPush } from "../jira/push.ts";
import { pullTest } from "../jira/read.ts";
import { readProject } from "../project.ts";
import { markRemoteChanged, readTest, renameTestFolder, testDir, writeTest } from "../store.ts";
import { freshXray, jiraKey, projectInfo } from "./connect.ts";
import { movedInJira, pullToLocal } from "./pull.ts";

export type Push = { plan: PushPlan; local: Test; id: string; hash: string };
export type OpState = "running" | "done" | "failed";
export type PushOutcome = { ok: boolean; id: string; failedAt?: number; error?: unknown; cancelled?: boolean };
export type OpResult = PushOpResult;
export type PlanView = PushPlanView & { planHash: string };
export type PushInput = { id: string; dryRun: boolean; planHash?: string; overwriteRemote: boolean; from?: number };
export type PushResult = {
  ok: boolean;
  id: string;
  plan: PlanView;
  ops: OpResult[];
  failedAt?: number;
  error?: string;
  cancelled?: boolean;
};

// ponytail: a push uploads only the test's own files — a path that leaves tests/<id>/ (.., absolute, a
// link pointing out) would send any file on the machine to Jira as an attachment
export function testFilePath(dir: string, file: string): string | null {
  if (!file || isAbsolute(file) || /^[A-Za-z]:/.test(file)) return null;
  const path = resolve(dir, file);
  const rel = relative(dir, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  if (!existsSync(path)) return path;
  const real = relative(realpathSync(dir), realpathSync(path));
  return real && !real.startsWith("..") && !isAbsolute(real) ? path : null;
}

export async function pushTest(project: string, id: string): Promise<Push> {
  jiraKey(project);
  const { test: local, remoteMd, md } = readTest(project, id);
  const dir = testDir(project, id);
  const outside = local.steps.flatMap((s, i) =>
    s.images.filter((im) => !testFilePath(dir, im.file)).map((im) => `step ${i + 1}: ${im.file}`),
  );
  if (outside.length)
    throw new UserError(
      `Not pushed — ${outside.join(", ")} ${outside.length > 1 ? "are" : "is"} outside the test folder tests/${id}/; a push only uploads the test's own images.`,
      "Remove that attachment from the step, or add the screenshot to the test again (it is copied into its images/ folder).",
    );
  const settings = readProject(project);
  const xray = await freshXray(project);
  const [info, me, remote] = await Promise.all([
    projectInfo(project),
    getMyself(),
    local.key ? pullTest(local.key) : null,
  ]);
  const remoteChanged = !!(remote && remoteMd && movedInJira(project, remote.test, remoteMd));
  if (remote && remoteMd) markRemoteChanged(project, id, remoteChanged);
  const plan = await planPush(local, id, remote, {
    project: info,
    accountId: me.accountId,
    readImage: async (file) => {
      const path = testFilePath(dir, file);
      if (!path) throw new Error(`${file} is outside the test folder`);
      return new Uint8Array(readFileSync(path));
    },
    fields: xray.fields,
    labelPrefix: settings.labelPrefix,
    remoteChanged,
  });
  return { plan, local, id, hash: planHash(plan, md) };
}

// ponytail: what the user confirmed — the ops in order and the exact test file they were built from; the
// push refuses to run a plan whose hash differs from the one shown
export const planHash = (plan: PushPlan, testMd: string) =>
  sha256([sha256(testMd), ...plan.ops.map((o) => `${o.kind}\t${o.label}`)].join("\n")).slice(0, 16);

export function planView(push: Push): PlanView {
  return {
    testId: push.id,
    ...(push.local.key ? { key: push.local.key } : {}),
    ops: push.plan.ops.map((o) => ({ label: o.label, kind: o.kind })),
    warnings: [...push.plan.warnings],
    remoteChanged: push.plan.remoteChanged,
    review: push.local.review,
    planHash: push.hash,
  };
}

const cancelledAt = (i: number, total: number) =>
  new Error(
    `Push cancelled — operation ${i + 1}${i + 1 < total ? ` and the ${total - i - 1} after it were` : " was"} not started.`,
  );

// A cancel is honoured between operations: the one in flight is let finish (cutting a Jira write short
// leaves Jira in a state nobody knows), the next is never started. `cancelled` says whether nothing ran
// after the cancel; when the op in flight finished after it, the push reports a stop, not a cancel.
export async function executePlan(
  project: string,
  push: Push,
  onProgress: (index: number, state: OpState) => void,
  from = 0,
  signal?: AbortSignal,
): Promise<PushOutcome> {
  const order = fieldOrder(project);
  const total = push.plan.ops.length;
  let id = push.id;
  let stored = !!push.local.key;
  let ranAfterCancel = false;
  for (let i = from; i < total; i++) {
    if (signal?.aborted)
      return { ok: false, id, failedAt: i, error: cancelledAt(i, total), cancelled: !ranAfterCancel };
    const op = push.plan.ops[i];
    if (op.kind === "create") {
      const now = (() => {
        try {
          return readTest(project, id).test;
        } catch {
          return null;
        }
      })();
      if (!now || now.key) {
        onProgress(i, "failed");
        const error = now?.key
          ? new UserError(
              `${id} was already created in Jira as ${now.key} — this plan is out of date.`,
              `Open ${now.key} and look at its new plan.`,
            )
          : new UserError(
              `${id} is no longer in tests/ — another push probably created it in Jira.`,
              "Refresh the test list and open the test under its Jira key.",
            );
        return { ok: false, id, failedAt: i, error };
      }
    }
    onProgress(i, "running");
    try {
      await op.run();
    } catch (error) {
      onProgress(i, "failed");
      return { ok: false, id, failedAt: i, error };
    }
    if (signal?.aborted) ranAfterCancel = true;
    // ponytail: the new key reaches the disk the moment it exists — a later failure must never let the
    // next push create the issue a second time
    if (!stored && push.local.key) {
      stored = true;
      writeTest(project, id, push.local, order);
    }
    onProgress(i, "done");
  }
  const key = push.local.key;
  if (!key) return { ok: true, id };
  try {
    if (id !== key) {
      writeTest(project, id, push.local, order);
      renameTestFolder(project, id, key);
      id = key;
    }
    await pullToLocal(project, key, { prev: push.local });
  } catch (error) {
    return { ok: true, id, error };
  }
  return { ok: true, id };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ponytail: the plan a failed push was executing, kept per test so "resume from op k" runs the same ops
// the user saw — a rebuilt plan would already have dropped the ops that went through
const unfinished = new Map<string, Push>();

// ponytail: one push of a test at a time in this process — two at once (two tabs, UI + Claude) would
// both run the create op and leave two Jira tests
const pushing = new Set<string>();

export function runPush(ctx: Ctx, project: string, input: PushInput): Promise<PushResult> {
  const slot = `${resolve(project)}|${input.id}`;
  if (input.dryRun) return push(ctx, project, slot, input);
  if (!input.planHash)
    throw new UserError(
      "A push runs only the plan you looked at — no planHash given.",
      `Run xray.plan for ${input.id} (or push with dryRun), check its ops, then push with its planHash.`,
      "no-plan-hash",
    );
  if (pushing.has(slot))
    throw new UserError(
      `A push of ${input.id} is already running.`,
      "Wait for it to finish (Jobs shows it), then look at the new plan.",
      "push-running",
    );
  pushing.add(slot);
  return scope(async (s) => {
    s.defer(() => pushing.delete(slot));
    return push(ctx, project, slot, input);
  });
}

async function push(ctx: Ctx, project: string, slot: string, input: PushInput): Promise<PushResult> {
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
      "plan-changed",
    );
  if (p.plan.remoteChanged && !input.overwriteRemote)
    throw new UserError(
      `${p.local.key ?? input.id} was changed in Jira since your last sync — pushing would replace that change.`,
      "Pull it from Jira first, or push with overwriteRemote to replace the Jira version.",
      "remote-changed",
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
