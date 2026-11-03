import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { UserError } from "../command.ts";
import { gate } from "../env.ts";
import type { ProjectInfo, PullStage, PushPlanView, Step, Test, XrayJson } from "../types.ts";
import { followXray } from "./columns.ts";
import { sha256 } from "./hash.ts";
import {
  byId,
  getMyself,
  getProjectInfo,
  getStepFields,
  type PushPlan,
  planPush,
  pullTest,
  reviewOfLabels,
} from "./jira.ts";
import { fieldOrder, readJson, readProject, readXray, writeJson, writeProject, writeXray } from "./project.ts";
import {
  addImage,
  markRemoteChanged,
  readTest,
  removeImageFile,
  renameTestFolder,
  testDir,
  writeRemote,
  writeTest,
} from "./store.ts";
import { imageRef, mapRefs, parseTest, serializeTest } from "./testfile.ts";

export type Push = { plan: PushPlan; local: Test; id: string; hash: string };
export type OpState = "running" | "done" | "failed";
export type PullOpts = { prev?: Test; signal?: AbortSignal; report?: (message: string, stage: PullStage) => void };
export type RemoteState = "unchanged" | "remote-changed" | "unverified";
export type PushOutcome = { ok: boolean; id: string; failedAt?: number; error?: unknown; cancelled?: boolean };

// ponytail: the one gate before Jira — a project with no key, or disconnected by the user, never reaches it
export function jiraKey(project: string): string {
  const p = readProject(project);
  if (p.jiraOffline)
    throw new UserError(
      `Jira is disconnected for this project — ${p.jiraProject} is neither read nor written.`,
      "Reconnect it from the Jira tab, or: testimus xray connect",
    );
  if (!p.jiraProject)
    throw new UserError(
      "This project is not connected to a Jira project.",
      "Connect one from the Jira tab, or: testimus xray connect LFRPS12",
    );
  return p.jiraProject;
}

const infoFile = (project: string) => join(project, ".testimus", "jira-project.json");

// ponytail: Jira's own project id and test issue type, asked once per project and kept as a derived file
export async function projectInfo(project: string): Promise<ProjectInfo> {
  const key = jiraKey(project);
  const cached = readJson<ProjectInfo | null>(infoFile(project), null);
  if (cached?.key === key && cached.id) return cached;
  const info = await getProjectInfo(key);
  writeJson(infoFile(project), info);
  return info;
}

// ponytail: the key is checked in Jira before it is saved — a typo or a project without Xray never becomes
// the project's key
export async function connectJira(project: string, key: string): Promise<ProjectInfo> {
  const info = await getProjectInfo(key);
  writeJson(infoFile(project), info);
  const { jiraOffline: _, ...cur } = readProject(project);
  writeProject(project, { ...cur, jiraProject: info.key, name: cur.name || info.key });
  return info;
}

export function disconnectJira(project: string): void {
  writeProject(project, { ...readProject(project), jiraOffline: true });
}

// ponytail: the step columns are read again from Xray before each push (Xray Editor reads them on every project
// open and push) and kept in xray.json with the local preferences; offline, the copy already there is used
export async function freshXray(project: string): Promise<XrayJson> {
  const x = readXray(project);
  try {
    const fields = await getStepFields((await projectInfo(project)).id);
    const next = { ...followXray(project, x, fields), fetchedAt: new Date().toISOString() };
    writeXray(project, next);
    return next;
  } catch {
    return x;
  }
}

export const extOf = (filename: string) => (/\.([A-Za-z0-9]+)$/.exec(filename)?.[1] ?? "png").toLowerCase();

// ponytail: the diff keeps only what a push can carry — attachment ids instead of our file names, no
// `status`, no Sources and no review keys (local by design; the review travels as a label, compared with
// the labels), and preconditions/covers as the sets Xray and Jira treat them as
export const forCompare = (t: Test) =>
  serializeTest({
    ...t,
    status: undefined,
    review: "draft",
    reviewNote: undefined,
    reviewedBy: undefined,
    reviewedAt: undefined,
    generatedBy: undefined,
    extra: {},
    preconditions: [...t.preconditions].sort(),
    covers: [...t.covers].sort(),
    steps: t.steps.map((s) => ({
      ...s,
      fields: Object.fromEntries(
        Object.entries(s.fields)
          .filter(([, v]) => v !== "")
          .map(([k, v]) => [k, byId(v, s.images)]),
      ),
      sources: [],
      images: s.images.map((im) => ({ ...im, file: im.remoteId ?? im.file })),
    })),
  });

// Jira knows nothing of Sources and review notes: a pull keeps them from the local copy it replaces. A
// step is matched by its Xray id; on the post-push re-pull (`prev` given) a step Jira re-created under a
// new id is matched by position, like its images. The review state comes from the label when there is one.
function keepLocal(pulled: Test, before: Test | null, byPosition: boolean, prefix: string): void {
  const labelled = reviewOfLabels(pulled.labels, prefix);
  pulled.review = labelled ?? before?.review ?? "draft";
  if (before && before.review === pulled.review) {
    pulled.reviewNote = before.reviewNote;
    pulled.reviewedBy = before.reviewedBy;
    pulled.reviewedAt = before.reviewedAt;
  }
  pulled.generatedBy = before?.generatedBy;
  pulled.extra = { ...(before?.extra ?? {}), ...pulled.extra };
  pulled.steps.forEach((s, i) => {
    const was: Step | undefined =
      before?.steps.find((b) => b.id && b.id === s.id) ?? (byPosition ? before?.steps[i] : undefined);
    s.sources = was?.sources.map((x) => ({ ...x })) ?? [];
  });
}

const cancelled = (key: string) => Object.assign(new Error(`Pull of ${key} cancelled`), { name: "AbortError" });

async function doPull(project: string, key: string, { prev, signal, report }: PullOpts): Promise<string> {
  jiraKey(project);
  const dir = testDir(project, key);
  const existed = existsSync(dir);
  const written: string[] = [];
  const undo = () => {
    for (const file of written)
      try {
        removeImageFile(project, key, file);
      } catch {}
    if (!existed && !existsSync(join(dir, "test.md"))) rmSync(dir, { recursive: true, force: true });
  };
  const abandoned = () => {
    if (!signal?.aborted) return false;
    undo();
    return true;
  };
  if (abandoned()) throw cancelled(key);

  const pulled = await pullTest(key);
  if (abandoned()) throw cancelled(key);
  const t = pulled.test;
  report?.(`${t.steps.length} steps fetched`, {
    phase: "read",
    summary: t.summary,
    folder: t.folder,
    ...(t.status ? { status: t.status } : {}),
    steps: t.steps.length,
    images: pulled.images.length,
    preconditions: t.preconditions.length,
    covers: t.covers.length,
    labels: t.labels.length,
  });

  let before: Test | null = prev ?? null;
  if (!before)
    try {
      before = readTest(project, key).test;
    } catch {}
  const known = new Map<string, string>();
  for (const s of before?.steps ?? []) for (const im of s.images) if (im.remoteId) known.set(im.remoteId, im.file);
  const renamed: Array<[number, string, string]> = [];

  const total = pulled.images.length;
  let n = 0;
  const one = async (im: (typeof pulled.images)[number]) => {
    const step = pulled.test.steps[im.stepIndex];
    const slot = step?.images.find((x) => x.remoteId === im.remoteId);
    if (!slot) return;
    const at = step.images.indexOf(slot);
    // ponytail: position only means something on the post-push re-pull, and only when that slot's own
    // attachment is gone — a newcomer Jira added meanwhile must not adopt a file still in use
    const was = prev ? before?.steps[im.stepIndex]?.images[at] : undefined;
    const gone = !was?.remoteId || !pulled.images.some((x) => x.remoteId === was.remoteId);
    const reuse = known.get(im.remoteId) ?? (gone ? was?.file : undefined);
    const take = (file: string) => {
      renamed.push([im.stepIndex, slot.file, file]);
      slot.file = file;
      report?.(`image ${++n} of ${total} downloaded`, { phase: "images", done: n, total });
    };
    if (reuse && existsSync(join(dir, reuse))) return take(reuse);
    const bytes = await im.download();
    if (signal?.aborted) return;
    const added = addImage(project, key, bytes, extOf(im.filename));
    written.push(added.file);
    take(added.file);
  };
  // ponytail: every download is waited out even when one fails, so none can write after the undo
  const failed = (await Promise.allSettled(pulled.images.map(one))).find(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  if (failed) {
    undo();
    throw failed.reason;
  }
  if (abandoned()) throw cancelled(key);

  for (const [stepIndex, from, to] of renamed) {
    const s = pulled.test.steps[stepIndex];
    for (const name of Object.keys(s.fields))
      s.fields[name] = mapRefs(s.fields[name], (file, params) => imageRef(file === from ? to : file, params));
  }

  keepLocal(pulled.test, before, !!prev, readProject(project).labelPrefix);
  if (abandoned()) throw cancelled(key);
  report?.("writing test.md", { phase: "write" });
  const md = writeTest(project, key, pulled.test, fieldOrder(readXray(project)));
  writeRemote(project, key, md);
  return key;
}

// ponytail: three pulls at a time — a burst feels parallel and the queue drains in order (jira.ts caps
// the requests at six too)
const pullSlot = gate(3);

export function pullToLocal(project: string, key: string, opts: PullOpts = {}): Promise<string> {
  return pullSlot(() => doPull(project, key, opts));
}

// ponytail: same comparison as remoteChanged, no image download; it leaves the marker store.ts reads, so
// the sidebar shows "changed in Jira" without asking Jira again
export async function checkRemote(project: string, id: string): Promise<RemoteState> {
  const { test, remoteMd } = readTest(project, id);
  const key = test.key;
  if (!key || !remoteMd || readProject(project).jiraOffline) return "unverified";
  const remote = await pullTest(key).catch(() => null);
  if (!remote) return "unverified";
  const changed = forCompare(remote.test) !== forCompare(parseTest(remoteMd).test);
  markRemoteChanged(project, id, changed);
  return changed ? "remote-changed" : "unchanged";
}

// ponytail: a push uploads only the test's own files — a path that leaves tests/<id>/ (.., absolute, a
// link pointing out) would send any file on the machine to Jira as an attachment
export function insideTest(dir: string, file: string): string | null {
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
    s.images.filter((im) => !insideTest(dir, im.file)).map((im) => `step ${i + 1}: ${im.file}`),
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
  if (
    remote &&
    remoteMd &&
    /^### (Action |Expected )?Images$/m.test(remoteMd) &&
    !/!\[\]\(/.test(remoteMd) &&
    remote.test.steps.some((s) => /!\[\]\(/.test(Object.values(s.fields).join("\n")))
  )
    throw new Error(
      `${local.key} was pulled by an older version of the app and Jira embeds screenshots it does not know — pull it from Jira before pushing (copy your local edits first, the pull overwrites them).`,
    );
  const remoteChanged = !!(remote && remoteMd && forCompare(remote.test) !== forCompare(parseTest(remoteMd).test));
  if (remote && remoteMd) markRemoteChanged(project, id, remoteChanged);
  const plan = await planPush(local, id, remote, {
    project: info,
    accountId: me.accountId,
    readImage: async (file) => {
      const path = insideTest(dir, file);
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

export function planView(push: Push): PushPlanView & { planHash: string } {
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
  const order = fieldOrder(readXray(project));
  const total = push.plan.ops.length;
  let id = push.id;
  let stored = !!push.local.key;
  let ranAfterCancel = false;
  for (let i = from; i < total; i++) {
    if (signal?.aborted)
      return { ok: false, id, failedAt: i, error: cancelledAt(i, total), cancelled: !ranAfterCancel };
    const op = push.plan.ops[i];
    if (op.kind === "create" && !push.local.key) {
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
