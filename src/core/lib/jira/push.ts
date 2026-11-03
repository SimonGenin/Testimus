import type { PlanOp, ProjectInfo, Test, XrayField } from "../../types.ts";
import { textToAdf } from "../adf.ts";
import { hasRawEmbed } from "../test-blocks.ts";
import { gql, jiraFetch } from "./http.ts";
import { labelPrefixOf, reviewLabels, reviewOfLabels } from "./labels.ts";
import { ISSUE_KEY, type PulledTest, preconditions, remoteSteps } from "./read.ts";
import {
  attachmentInput,
  base,
  byId,
  customInput,
  fieldOf,
  imageOps,
  knownIds,
  orBlank,
  type RawStep,
  type ReadImage,
  refsIn,
  stepInput,
  toMarkers,
} from "./steps.ts";

export type PushOp = PlanOp & { run: () => Promise<void> };
export type PushPlan = { ops: PushOp[]; warnings: string[]; remoteChanged: boolean };
export type PushDeps = {
  project: ProjectInfo;
  accountId: string;
  readImage: ReadImage;
  fields: XrayField[];
  labelPrefix: string;
  remoteChanged?: boolean;
};
export type StepSync = { mode: "in-place"; remove: string[]; update: number[]; add: number[] } | { mode: "rebuild" };

const ADD_PRECONDITIONS = `mutation($issueId:String!,$ids:[String]!){
  addPreconditionsToTest(issueId:$issueId,preconditionIssueIds:$ids){ addedPreconditions warning }
}`;

const REMOVE_PRECONDITIONS = `mutation($issueId:String!,$ids:[String]!){
  removePreconditionsFromTest(issueId:$issueId,preconditionIssueIds:$ids)
}`;

const CREATE_TEST = `mutation($jira:JSON!,$steps:[CreateStepInput],$folder:String,$preconditions:[String]){
  createTest(jira:{fields:$jira},testType:{name:"Manual"},steps:$steps,folderPath:$folder,preconditionIssueIds:$preconditions){
    test { issueId jira(fields:["key"]) }
    warnings
  }
}`;

const ADD_STEP = `mutation($issueId:String!,$step:CreateStepInput!){
  addTestStep(issueId:$issueId,step:$step){ id }
}`;

const UPDATE_STEP = `mutation($stepId:String!,$step:UpdateStepInput!){
  updateTestStep(stepId:$stepId,step:$step){ warnings }
}`;

const REMOVE_STEP = `mutation($stepId:String!){ removeTestStep(stepId:$stepId) }`;

const REMOVE_ALL_STEPS = `mutation($issueId:String!){ removeAllTestSteps(issueId:$issueId) }`;

const UPDATE_FOLDER = `mutation($issueId:String!,$folderPath:String!){
  updateTestFolder(issueId:$issueId,folderPath:$folderPath)
}`;

export function decideStepSync(localIds: Array<string | undefined>, remoteIds: string[]): StepSync {
  const withId = localIds.flatMap((id, i) => (id ? [{ id, i }] : []));
  const lastWithId = withId.length ? withId[withId.length - 1].i : -1;
  if (localIds.some((id, i) => !id && i < lastWithId)) return { mode: "rebuild" };
  let r = 0;
  for (const { id } of withId) {
    while (r < remoteIds.length && remoteIds[r] !== id) r++;
    if (r === remoteIds.length) return { mode: "rebuild" };
    r++;
  }
  const kept = new Set(withId.map((x) => x.id));
  return {
    mode: "in-place",
    remove: remoteIds.filter((id) => !kept.has(id)),
    update: withId.map((x) => x.i),
    add: localIds.flatMap((id, i) => (id ? [] : [i])),
  };
}

const link = (type: string, from: string, to: string) =>
  jiraFetch(
    "POST",
    "/rest/api/3/issueLink",
    { type: { name: type }, inwardIssue: { key: from }, outwardIssue: { key: to } },
    `link ${type} ${from} to ${to}`,
  ).then(() => undefined);

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const plural = (n: number) => (n > 1 ? "s" : "");

export async function planPush(
  local: Test,
  testId: string,
  remote: PulledTest | null,
  deps: PushDeps,
): Promise<PushPlan> {
  const ops: PushOp[] = [];
  const embeds: PushOp[] = [];
  const warnings: string[] = [];
  const schema = deps.fields;
  const done = () => ({ ops: [...ops, ...embeds], warnings, remoteChanged: !!deps.remoteChanged });
  const prefix = labelPrefixOf(deps.labelPrefix);
  if (prefix !== deps.labelPrefix)
    warnings.push(
      `The label prefix "${deps.labelPrefix}" in project.json is empty or has a space — the review label uses ${prefix} instead (set a prefix without spaces in the project settings).`,
    );
  if (deps.remoteChanged) warnings.push("Changed in Jira since your last sync — pushing will overwrite.");
  if (!local.summary.trim()) warnings.push("The summary is empty.");
  if (local.review !== "validated")
    warnings.push(
      `This test is not validated (review: ${local.review}) — it goes to Jira labelled ${prefix}${local.review}.`,
    );
  const known = new Set(schema.map((f) => f.name));
  // ponytail: only a column that holds something would be sent, so only that one is worth a warning (Xray Editor)
  const unknown = [
    ...new Set(local.steps.flatMap((s) => Object.keys(s.fields).filter((n) => !known.has(n) && s.fields[n]?.trim()))),
  ];
  if (unknown.length)
    warnings.push(
      `${unknown.map((n) => `"${n}"`).join(", ")} ${unknown.length > 1 ? "are not step fields" : "is not a step field"} of ${deps.project.key} — not pushed (refresh the fields with xray.refreshFields if it was just added).`,
    );
  for (const f of schema) {
    if (!f.required || f.disabled || f.builtin) continue;
    const empty = local.steps.flatMap((s, i) => (s.fields[f.name]?.trim() ? [] : [i + 1]));
    if (empty.length) warnings.push(`${f.name} is required in Xray and empty in step ${empty.join(", ")}.`);
  }

  const labels = reviewLabels(local.labels, local.review, deps.labelPrefix);
  const unreadable = local.steps.flatMap((s, i) => (hasRawEmbed(s) ? [i + 1] : []));

  // ponytail: only an answer worth having is kept — a failed or index-lagged fetch is made again on retry
  let fetched: RawStep[] = [];
  const stepsInJira = async () => {
    if (fetched.length) return fetched;
    fetched = await remoteSteps(local.key ?? "");
    return fetched;
  };

  const embedOp = (i: number) => {
    const n = new Set(refsIn(local.steps[i])).size;
    embeds.push({
      label: `Embed ${n} image${n > 1 ? "s" : ""} in step ${i + 1}`,
      kind: "embed",
      run: async () => {
        const rs = (await stepsInJira())[i];
        if (!rs?.id) throw new Error(`Step ${i + 1} is not in Jira — refresh the test and push again.`);
        const s = local.steps[i];
        const atts = rs.attachments ?? [];
        const ids = new Map(
          s.images.map((im) => [im.file, atts.find((a) => a.filename === base(im.file))?.id ?? im.remoteId ?? ""]),
        );
        await gql(UPDATE_STEP, {
          stepId: rs.id,
          step: {
            action: orBlank(toMarkers(fieldOf(s, "Action"), ids)),
            data: toMarkers(fieldOf(s, "Data"), ids),
            result: toMarkers(fieldOf(s, "Expected Result"), ids),
          },
        });
      },
    });
  };

  const resolve = async (keys: string[]): Promise<Array<{ key: string; issueId: string }>> => {
    const found = new Map<string, string>();
    const wanted = keys.filter((k) => {
      if (ISSUE_KEY.test(k)) return true;
      warnings.push(`"${k}" is not an issue key — not attached as a precondition.`);
      return false;
    });
    if (wanted.length)
      for (const p of (await preconditions({ jql: `key in (${wanted.join(", ")})` })).list) found.set(p.key, p.issueId);
    return wanted.flatMap((key) => {
      const issueId = found.get(key);
      if (issueId) return [{ key, issueId }];
      warnings.push(`${key} is not a precondition of this project — not attached.`);
      return [];
    });
  };

  const linkOps = (existing: { covers: string[]; clonedFrom?: string }) => {
    if (local.clonedFrom && local.clonedFrom !== existing.clonedFrom)
      ops.push({
        label: `Link Cloners to ${local.clonedFrom}`,
        kind: "link",
        run: () => link("Cloners", local.key!, local.clonedFrom!),
      });
    for (const c of local.covers)
      if (!existing.covers.includes(c))
        ops.push({ label: `Link Test to ${c}`, kind: "link", run: () => link("Test", local.key!, c) });
    for (const c of existing.covers)
      if (!local.covers.includes(c)) warnings.push(`Jira still links Test to ${c}; links are never removed.`);
  };

  if (!local.key) {
    if (unreadable.length) {
      warnings.push(
        `Step ${unreadable.join(", ")} carries Xray markup this editor could not read, and it names attachments of the test it was copied from — the test is not created. Remove that markup, or download the original from Jira.`,
      );
      return done();
    }
    const steps = await Promise.all(local.steps.map((s) => stepInput(s, deps.readImage, schema)));
    const pre = await resolve(local.preconditions);
    const preIds = pre.map((p) => p.issueId);
    ops.push({
      label:
        `Create test in Jira (${testId})` +
        (preIds.length ? ` with ${preIds.length} precondition${plural(preIds.length)}` : ""),
      kind: "create",
      run: async () => {
        const fields: Record<string, unknown> = {
          project: { key: deps.project.key },
          issuetype: { id: deps.project.testIssueTypeId },
          summary: local.summary,
          assignee: { id: deps.accountId },
          labels,
        };
        // ponytail: Xray forwards this JSON to Jira's *v2* create, where a description is wiki-markup text
        if (local.description.trim()) fields.description = local.description;
        const d = await gql<{ createTest: { test: { issueId: string; jira: { key: string } }; warnings?: string[] } }>(
          CREATE_TEST,
          { jira: fields, steps, folder: local.folder || undefined, preconditions: preIds.length ? preIds : undefined },
        );
        local.key = d.createTest.test.jira.key;
        warnings.push(...(d.createTest.warnings ?? []));
      },
    });
    linkOps({ covers: [] });
    local.steps.forEach((s, i) => {
      if (refsIn(s).length) embedOp(i);
    });
    return done();
  }

  if (!remote) throw new Error(`${local.key} was never pulled — refresh it from Jira before pushing.`);
  const key = local.key;
  const issueId = remote.issueId;
  const r = remote.test;

  const fields: Record<string, unknown> = {};
  const changed: string[] = [];
  if (local.summary !== r.summary) {
    fields.summary = local.summary;
    changed.push("summary");
  }
  const labelsChanged = !same(labels, r.labels);
  if (labelsChanged) {
    fields.labels = labels;
    changed.push("labels");
  }
  if (local.description.trim() !== r.description.trim()) {
    fields.description = textToAdf(local.description);
    changed.push("description");
  }
  const reviewMoved = labelsChanged && reviewOfLabels(r.labels, prefix) !== local.review;
  if (changed.length)
    ops.push({
      label: `Update ${changed.join(", ")}` + (reviewMoved ? ` (review label ${prefix}${local.review})` : ""),
      kind: changed.length === 1 && labelsChanged ? "label" : "update",
      run: () =>
        jiraFetch("PUT", `/rest/api/3/issue/${encodeURIComponent(key)}`, { fields }, `issue ${key}`).then(
          () => undefined,
        ),
    });

  if (local.folder && local.folder !== r.folder)
    ops.push({
      label: `Move to folder ${local.folder}`,
      kind: "folder",
      run: async () => void (await gql(UPDATE_FOLDER, { issueId, folderPath: local.folder })),
    });

  linkOps({ covers: r.covers, clonedFrom: r.clonedFrom });

  const attach = local.preconditions.filter((k) => !r.preconditions.includes(k));
  const detach = remote.preconditions.filter((p) => !local.preconditions.includes(p.key));
  if (attach.length) {
    const found = await resolve(attach);
    if (found.length)
      ops.push({
        label: `Attach precondition${plural(found.length)} ${found.map((p) => p.key).join(", ")}`,
        kind: "other",
        run: async () => {
          const d = await gql<{ addPreconditionsToTest: { warning?: string | null } }>(ADD_PRECONDITIONS, {
            issueId,
            ids: found.map((p) => p.issueId),
          });
          const w = d.addPreconditionsToTest?.warning;
          if (w) warnings.push(w);
        },
      });
  }
  if (detach.length)
    ops.push({
      label: `Detach precondition${plural(detach.length)} ${detach.map((p) => p.key).join(", ")}`,
      kind: "other",
      run: async () => void (await gql(REMOVE_PRECONDITIONS, { issueId, ids: detach.map((p) => p.issueId) })),
    });

  const sync = decideStepSync(
    local.steps.map((s) => s.id),
    r.steps.map((s) => s.id ?? ""),
  );

  if (sync.mode === "rebuild") {
    if (unreadable.length) {
      warnings.push(
        `Step ${unreadable.join(", ")} carries Xray markup this editor could not read, and the steps were reordered — no step is touched. Download from Jira, or move the steps back.`,
      );
      return done();
    }
    warnings.push("Steps were reordered or inserted — every step is recreated, so the Jira step ids change.");
    const inputs = await Promise.all(local.steps.map((s) => stepInput(s, deps.readImage, schema)));
    ops.push({
      label: `Remove all ${r.steps.length} remote steps`,
      kind: "update",
      run: async () => void (await gql(REMOVE_ALL_STEPS, { issueId })),
    });
    inputs.forEach((step, i) => {
      ops.push({
        label: `Add step ${i + 1}`,
        kind: "update",
        run: async () => void (await gql(ADD_STEP, { issueId, step })),
      });
    });
    local.steps.forEach((s, i) => {
      if (refsIn(s).length) embedOp(i);
    });
    return done();
  }

  for (const id of sync.remove) {
    const n = r.steps.findIndex((s) => s.id === id) + 1;
    ops.push({
      label: `Remove step ${n}`,
      kind: "update",
      run: async () => void (await gql(REMOVE_STEP, { stepId: id })),
    });
  }

  for (const i of sync.update) {
    const ls = local.steps[i];
    const rs = r.steps.find((s) => s.id === ls.id)!;
    if (hasRawEmbed(ls)) {
      warnings.push(`Step ${i + 1} carries Xray markup this editor could not read — it is left untouched in Jira.`);
      continue;
    }
    const ids = knownIds(ls);
    const { add, removeIds } = imageOps(ls.images, rs.images);
    const alive = rs.images.flatMap((im) => (im.remoteId && !removeIds.includes(im.remoteId) ? [im.remoteId] : []));
    const embed = refsIn(ls).some((f) => !alive.includes(ids.get(f) ?? ""));
    const text: Record<string, unknown> = {};
    const norm = (t: string) => t.replace(/\r\n/g, "\n").trim();
    const differs = (name: string) =>
      norm(byId(fieldOf(ls, name), ls.images)) !== norm(byId(fieldOf(rs, name), rs.images));
    if (!embed) {
      if (differs("Action")) text.action = orBlank(toMarkers(fieldOf(ls, "Action"), ids));
      if (differs("Data")) text.data = toMarkers(fieldOf(ls, "Data"), ids);
      if (differs("Expected Result")) text.result = toMarkers(fieldOf(ls, "Expected Result"), ids);
    }
    const custom = customInput(ls, schema, (name) => norm(fieldOf(ls, name)) !== norm(fieldOf(rs, name)));
    if (custom.length) text.customFields = custom;
    if (!Object.keys(text).length && !add.length && !removeIds.length) continue;
    if (embed) embedOp(i);
    const parts: string[] = [];
    if (Object.keys(text).length) parts.push(`Update step ${i + 1}`);
    if (add.length) parts.push(`Upload ${add.length} image${plural(add.length)} to step ${i + 1}`);
    if (removeIds.length) parts.push(`Remove ${removeIds.length} image${plural(removeIds.length)} from step ${i + 1}`);
    const uploads = await Promise.all(add.map((im) => attachmentInput(im.file, deps.readImage)));
    const step: Record<string, unknown> = { ...text };
    if (add.length || removeIds.length)
      step.attachments = {
        ...(uploads.length ? { add: uploads } : {}),
        ...(removeIds.length ? { removeIds } : {}),
      };
    ops.push({
      label: parts.join(" + "),
      kind: add.length ? "upload" : "update",
      run: async () => void (await gql(UPDATE_STEP, { stepId: ls.id, step })),
    });
  }

  for (const i of sync.add) {
    const step = await stepInput(local.steps[i], deps.readImage, schema);
    ops.push({
      label: `Add step ${i + 1}`,
      kind: "update",
      run: async () => void (await gql(ADD_STEP, { issueId, step })),
    });
    if (refsIn(local.steps[i]).length) embedOp(i);
  }

  return done();
}
