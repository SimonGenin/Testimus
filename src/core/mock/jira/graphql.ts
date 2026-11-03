import type { HttpRes } from "../../env.ts";
import {
  type MAttachment,
  MOCK_JIRA,
  MOCK_PROJECT,
  type MPrecondition,
  type MStep,
  type MTest,
  mockJira,
  newTest,
  next,
  STEP_FIELDS,
  st,
} from "./state.ts";

export const json = (body: unknown, status = 200): HttpRes => ({
  status,
  headers: { "content-type": "application/json" },
  text: JSON.stringify(body),
});
const gqlError = (message: string) => json({ errors: [{ message }] });

function precondition(p: MPrecondition) {
  return { issueId: p.issueId, definition: p.definition, jira: { key: p.key, summary: p.summary } };
}

function rawStep(s: MStep) {
  return {
    id: s.id,
    action: s.action,
    data: s.data || null,
    result: s.result,
    attachments: s.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      downloadLink: `${MOCK_JIRA}/rest/api/3/attachment/content/${a.id}`,
    })),
    customFields: Object.entries(s.custom).map(([id, value]) => ({
      id,
      name: STEP_FIELDS.find((f) => f.id === id)?.name ?? id,
      value,
    })),
  };
}

function rawTest(t: MTest) {
  const pre = st().preconditions.filter((p) => t.preconditions.includes(p.issueId));
  return {
    issueId: t.issueId,
    projectId: MOCK_PROJECT.id,
    testType: { name: "Manual" },
    folder: { path: t.folder },
    jira: { key: t.key, summary: t.summary, status: { name: t.status }, labels: t.labels },
    steps: t.steps.map(rawStep),
    preconditions: { total: pre.length, results: pre.map(precondition) },
  };
}

function folderNode(path: string): unknown {
  const s = st();
  const all = new Set([...s.folders, ...[...s.tests.values()].map((t) => t.folder).filter(Boolean)]);
  const children = [...all]
    .filter((p) => p !== path && p.startsWith(path === "/" ? "/" : `${path}/`))
    .filter((p) => !p.slice(path === "/" ? 1 : path.length + 1).includes("/"))
    .sort();
  return {
    name: path === "/" ? "/" : path.split("/").pop(),
    path,
    testsCount: [...s.tests.values()].filter((t) => (t.folder || "/") === path).length,
    folders: children.map(folderNode),
  };
}

function folderNodeExists(path: string): boolean {
  const s = st();
  return s.folders.includes(path) || [...s.tests.values()].some((t) => t.folder === path);
}

function matchJql(t: MTest, jql: string): boolean {
  const keys = [
    ...[...jql.matchAll(/\bkey\s*=\s*"?([A-Za-z][A-Za-z0-9]*-\d+)/g)].map((m) => m[1]),
    ...[...jql.matchAll(/\bkey\s+in\s*\(([^)]*)\)/g)].flatMap((m) => m[1].split(",").map((k) => k.trim())),
  ];
  const needle = /summary\s*~\s*"((?:[^"\\]|\\.)*)"/.exec(jql)?.[1]?.replace(/\\(.)/g, "$1");
  const linked = /linkedIssues\("([^"]+)"\)/.exec(jql)?.[1];
  if (!keys.length && needle === undefined && !linked) return true;
  if (keys.includes(t.key)) return true;
  if (needle !== undefined) {
    const words = needle.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.every((w) => t.summary.toLowerCase().includes(w))) return true;
  }
  return !!linked && t.links.some((l) => l.key === linked);
}

function decode(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

type AttIn = { filename: string; mimeType?: string; data: string };
type StepIn = {
  action?: string;
  data?: string;
  result?: string;
  attachments?: AttIn[] | { add?: AttIn[]; removeIds?: string[] };
  customFields?: Array<{ id: string; value: unknown }>;
};

const size = (n: number) =>
  n >= 1048576 ? `${+(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${+(n / 1024).toFixed(1)} KB` : `${n} bytes`;

function upload(list: AttIn[]): MAttachment[] {
  for (const a of list) {
    const bytes = decode(a.data);
    if (bytes.length > mockJira.maxAttachmentBytes)
      throw new Error(
        `Attachment ${a.filename} is ${size(bytes.length)} — over the ${size(mockJira.maxAttachmentBytes)} Jira accepts.`,
      );
  }
  return list.map((a) => {
    const id = `m-att-${next()}`;
    st().files.set(id, decode(a.data));
    return { id, filename: a.filename };
  });
}

function applyStep(s: MStep, input: StepIn): void {
  const att = input.attachments;
  const added = upload(Array.isArray(att) ? att : (att?.add ?? []));
  if (input.action !== undefined) s.action = input.action;
  if (input.data !== undefined) s.data = input.data;
  if (input.result !== undefined) s.result = input.result;
  for (const cf of input.customFields ?? []) {
    if (!STEP_FIELDS.some((f) => f.id === cf.id)) throw new Error(`Custom field ${cf.id} does not exist.`);
    const v = cf.value == null ? "" : String(cf.value);
    if (v) s.custom[cf.id] = v;
    else delete s.custom[cf.id];
  }
  if (att && !Array.isArray(att)) s.attachments = s.attachments.filter((a) => !att.removeIds?.includes(a.id));
  s.attachments.push(...added);
}

function newStep(input: StepIn): MStep {
  if (!(input.action ?? "").length) throw new Error("one of 'action' or 'callTestIssueId' is required");
  const s: MStep = { id: `m-step-${next()}`, action: "", data: "", result: "", custom: {}, attachments: [] };
  applyStep(s, input);
  return s;
}

function byIssueId(issueId: string): MTest {
  const t = [...st().tests.values()].find((x) => x.issueId === issueId);
  if (!t) throw new Error(`Test with id ${issueId} not found.`);
  return t;
}

function byStepId(stepId: string): { t: MTest; i: number } {
  for (const t of st().tests.values()) {
    const i = t.steps.findIndex((s) => s.id === stepId);
    if (i >= 0) return { t, i };
  }
  throw new Error(`Step ${stepId} not found.`);
}

function createTest(jira: Record<string, any>, steps: StepIn[], folder?: string, pre?: string[]) {
  if (jira.project?.key !== MOCK_PROJECT.key) throw new Error(`project: project ${jira.project?.key} does not exist`);
  if (!jira.summary) throw new Error("summary: You must specify a summary of the issue.");
  if (jira.description !== undefined && typeof jira.description !== "string")
    throw new Error("description: Operation value must be a string");
  const built = (steps ?? []).map(newStep);
  const n = 1500 + next();
  const t = newTest({
    issueId: String(50000 + n),
    key: `${MOCK_PROJECT.key}-${n}`,
    summary: jira.summary,
    folder: folder || "/",
    labels: jira.labels ?? [],
    description: jira.description ?? "",
    preconditions: pre ?? [],
    steps: built,
  });
  st().tests.set(t.key, t);
  return t;
}

export function graphql(query: string, v: Record<string, any>): HttpRes {
  const s = st();
  const has = (name: string) => new RegExp(`\\b${name}\\s*\\(`).test(query);
  try {
    if (has("createTest")) {
      const t = createTest(v.jira ?? {}, v.steps ?? [], v.folder, v.preconditions);
      return json({ data: { createTest: { test: { issueId: t.issueId, jira: { key: t.key } }, warnings: [] } } });
    }
    if (has("addTestStep")) {
      const t = byIssueId(v.issueId);
      const created = newStep(v.step ?? {});
      t.steps.push(created);
      return json({ data: { addTestStep: { id: created.id } } });
    }
    if (has("updateTestStep")) {
      const { t, i } = byStepId(v.stepId);
      applyStep(t.steps[i], v.step ?? {});
      return json({ data: { updateTestStep: { warnings: [] } } });
    }
    if (has("removeAllTestSteps")) {
      byIssueId(v.issueId).steps = [];
      return json({ data: { removeAllTestSteps: "ok" } });
    }
    if (has("removeTestStep")) {
      const { t, i } = byStepId(v.stepId);
      t.steps.splice(i, 1);
      return json({ data: { removeTestStep: "ok" } });
    }
    if (has("updateTestFolder")) {
      byIssueId(v.issueId).folder = v.folderPath;
      return json({ data: { updateTestFolder: "ok" } });
    }
    if (has("addPreconditionsToTest")) {
      const t = byIssueId(v.issueId);
      const ids = (v.ids ?? []) as string[];
      t.preconditions = [...new Set([...t.preconditions, ...ids])];
      return json({ data: { addPreconditionsToTest: { addedPreconditions: ids, warning: null } } });
    }
    if (has("removePreconditionsFromTest")) {
      const t = byIssueId(v.issueId);
      t.preconditions = t.preconditions.filter((id) => !(v.ids ?? []).includes(id));
      return json({ data: { removePreconditionsFromTest: "ok" } });
    }
    if (has("getProjectSettings")) {
      const p = String(v.projectIdOrKey ?? "");
      if (p !== MOCK_PROJECT.id && p !== MOCK_PROJECT.key) return json({ data: { getProjectSettings: null } });
      return json({
        data: { getProjectSettings: { projectId: MOCK_PROJECT.id, testStepSettings: { fields: STEP_FIELDS } } },
      });
    }
    if (has("getFolder")) {
      const path = String(v.path || "/");
      const exists = path === "/" || folderNodeExists(path);
      return json({ data: { getFolder: exists ? folderNode(path) : null } });
    }
    if (has("getTests")) {
      let list = [...s.tests.values()];
      if (v.jql) list = list.filter((t) => matchJql(t, v.jql));
      else if (v.folder) {
        const path = v.folder.path || "/";
        list = list.filter((t) =>
          v.folder.includeDescendants
            ? path === "/" || t.folder === path || t.folder.startsWith(`${path}/`)
            : (t.folder || "/") === path,
        );
      }
      list.sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));
      const start = v.start ?? 0;
      const limit = v.limit ?? 100;
      return json({
        data: {
          getTests: { total: list.length, start, limit, results: list.slice(start, start + limit).map(rawTest) },
        },
      });
    }
    if (has("getPreconditions")) {
      const list = v.jql ? s.preconditions.filter((p) => new RegExp(`\\b${p.key}\\b`).test(v.jql)) : s.preconditions;
      return json({ data: { getPreconditions: { total: list.length, results: list.map(precondition) } } });
    }
    return gqlError("mock: unsupported GraphQL query");
  } catch (e) {
    return gqlError((e as Error).message);
  }
}
