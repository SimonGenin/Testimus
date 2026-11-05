import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CancelledError, scope, semaphore } from "../../../shared/run/work.ts";
import type { PullStage, Step, Test } from "../../types.ts";
import { fieldOrder } from "../columns.ts";
import { reviewOfLabels, withoutReviewLabels } from "../jira/labels.ts";
import { pullTest } from "../jira/read.ts";
import { byId } from "../jira/steps.ts";
import { readProject, readXray } from "../project.ts";
import { addImage, markRemoteChanged, readTest, removeImageFile, testDir, writeRemote, writeTest } from "../store.ts";
import { imageRef, mapRefs } from "../test-blocks.ts";
import { parseTest, serializeTest } from "../testfile.ts";
import { jiraKey } from "./connect.ts";

export type PullOpts = { prev?: Test; signal?: AbortSignal; report?: (message: string, stage: PullStage) => void };
export type RemoteState = "unchanged" | "remote-changed" | "unverified";

export const extOf = (filename: string) => (/\.([A-Za-z0-9]+)$/.exec(filename)?.[1] ?? "png").toLowerCase();

// ponytail: the diff keeps only what a push can carry — attachment ids instead of our file names, no
// `status` nor assignee (issue.* moves them), no Sources and no review keys (local by design; the review travels as a label, compared with
// the labels), no step field switched off in Xray (`local`: it never goes up), and preconditions/covers as the sets
// Xray and Jira treat them as
export const forCompare = (t: Test, local: readonly string[] = []) =>
  serializeTest({
    ...t,
    status: undefined,
    assignee: undefined,
    assigneeId: undefined,
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
          .filter(([k, v]) => v !== "" && !local.includes(k))
          .map(([k, v]) => [k, byId(v, s.images)]),
      ),
      sources: [],
      images: s.images.map((im) => ({ file: im.remoteId ?? im.file, ...(im.remoteId && { remoteId: im.remoteId }) })),
    })),
  });

// The step fields switched off in Xray: Xray refuses them a value, so they live in test.md alone
export const localOnly = (project: string) =>
  readXray(project)
    .fields.filter((f) => f.disabled)
    .map((f) => f.name);

// Jira knows nothing of Sources, review notes and the fields switched off in Xray (`local`): a pull keeps them from
// the local copy it replaces. A step is matched by its Xray id; on the post-push re-pull (`prev` given) a step Jira
// re-created under a new id is matched by position, like its images. The review state comes from the label when
// there is one.
function keepLocal(
  pulled: Test,
  before: Test | null,
  byPosition: boolean,
  prefix: string,
  local: readonly string[],
): void {
  const labelled = reviewOfLabels(pulled.labels, prefix);
  pulled.labels = withoutReviewLabels(pulled.labels, prefix);
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
    if (was) for (const name of local) s.fields[name] = was.fields[name] ?? "";
  });
}

// ponytail: a pull that does not reach test.md takes back every image it wrote, and the folder it made — whatever
// stops it (a cancel, a failed download, an error); downloads are all waited out first, so none writes after
function doPull(project: string, key: string, { prev, signal, report }: PullOpts): Promise<string> {
  jiraKey(project);
  const dir = testDir(project, key);
  const existed = existsSync(dir);
  const written: string[] = [];
  let kept = false;
  return scope(async (s) => {
    s.defer(() => {
      if (kept) return;
      for (const file of written)
        try {
          removeImageFile(project, key, file);
        } catch {}
      if (!existed && !existsSync(join(dir, "test.md"))) rmSync(dir, { recursive: true, force: true });
    });
    const stopIfCancelled = () => {
      if (signal?.aborted) throw new CancelledError(`Pull of ${key} cancelled`);
    };
    stopIfCancelled();

    const pulled = await pullTest(key);
    stopIfCancelled();
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
    const figureOf = new Map<string, string>();
    for (const st of before?.steps ?? [])
      for (const im of st.images) {
        if (im.remoteId) known.set(im.remoteId, im.file);
        if (im.figure) figureOf.set(im.file, im.figure);
      }
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
        const figure = figureOf.get(file);
        if (figure) slot.figure = figure;
        report?.(`image ${++n} of ${total} downloaded`, { phase: "images", done: n, total });
      };
      if (reuse && existsSync(join(dir, reuse))) return take(reuse);
      const bytes = await im.download();
      if (signal?.aborted) return;
      const added = addImage(project, key, bytes, extOf(im.filename));
      written.push(added.file);
      take(added.file);
    };
    const failed = (await Promise.allSettled(pulled.images.map(one))).find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (failed) throw failed.reason;
    stopIfCancelled();

    for (const [stepIndex, from, to] of renamed) {
      const st = pulled.test.steps[stepIndex];
      for (const name of Object.keys(st.fields))
        st.fields[name] = mapRefs(st.fields[name], (file, params) => imageRef(file === from ? to : file, params));
    }

    keepLocal(pulled.test, before, !!prev, readProject(project).labelPrefix, localOnly(project));
    stopIfCancelled();
    report?.("writing test.md", { phase: "write" });
    const md = writeTest(project, key, pulled.test, fieldOrder(project));
    kept = true;
    writeRemote(project, key, md);
    return key;
  });
}

// ponytail: three pulls at a time — a burst feels parallel and the queue drains in order (jira/http.ts caps
// the requests at six too)
const pullSlot = semaphore(3);

export function pullToLocal(project: string, key: string, opts: PullOpts = {}): Promise<string> {
  return pullSlot(() => doPull(project, key, opts));
}

// ponytail: Jira moved since the last pull — its content, or its review label (test.md keeps no review label: the
// label read at the last pull is the review .remote.md holds)
export function movedInJira(project: string, remote: Test, remoteMd: string): boolean {
  const prefix = readProject(project).labelPrefix;
  const was = parseTest(remoteMd).test;
  const label = reviewOfLabels(remote.labels, prefix);
  const local = localOnly(project);
  const bare = (t: Test) => forCompare({ ...t, labels: withoutReviewLabels(t.labels, prefix) }, local);
  return bare(remote) !== bare(was) || (label !== undefined && label !== was.review);
}

// ponytail: same comparison as remoteChanged, no image download; it leaves the marker store.ts reads, so
// the sidebar shows "changed in Jira" without asking Jira again
export async function checkRemote(project: string, id: string): Promise<RemoteState> {
  const { test, remoteMd } = readTest(project, id);
  const key = test.key;
  if (!key || !remoteMd || readProject(project).jiraOffline) return "unverified";
  const remote = await pullTest(key).catch(() => null);
  if (!remote) return "unverified";
  const changed = movedInJira(project, remote.test, remoteMd);
  markRemoteChanged(project, id, changed);
  return changed ? "remote-changed" : "unchanged";
}
