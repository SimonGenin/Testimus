import type { Folder, Precondition, ProjectInfo, RemoteTestRef, Step, Test, XrayField } from "../../types.ts";
import { adfToText } from "../adf.ts";
import { type JiraCreds, jiraCreds } from "../creds.ts";
import { basic, gql, jiraFetch, RATE_LIMITED, send, xrayJwt } from "./http.ts";
import { BUILTIN, type RawStep, readStep } from "./steps.ts";

export type PulledImage = {
  stepIndex: number;
  remoteId: string;
  filename: string;
  download: () => Promise<Uint8Array>;
};
export type PulledTest = { test: Test; issueId: string; images: PulledImage[]; preconditions: Precondition[] };
export type TestQuery = { folder: string; descendants?: boolean } | { jql: string };

export const PAGE = 100;
export const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9]*-[0-9]+$/;

const GET_STEP_FIELDS = `query($projectIdOrKey:String!){
  getProjectSettings(projectIdOrKey:$projectIdOrKey){ testStepSettings { fields { id name type required disabled } } }
}`;

const GET_FOLDER = `query($projectId:String!,$path:String!){
  getFolder(projectId:$projectId,path:$path){ name path testsCount folders }
}`;

const GET_TESTS = `query($jql:String,$projectId:String,$folder:FolderSearchInput,$limit:Int!,$start:Int){
  getTests(jql:$jql,projectId:$projectId,folder:$folder,limit:$limit,start:$start){
    total
    results { issueId folder{path} jira(fields:["key","summary","status","labels"]) steps{id} }
  }
}`;

const GET_TEST_STEPS = `query($jql:String!){
  getTests(jql:$jql,limit:1){
    results {
      issueId
      folder{path}
      jira(fields:["key"])
      steps { id action data result customFields { id name value } attachments { id filename downloadLink } }
      preconditions(limit:100){ results { issueId definition jira(fields:["key","summary"]) } }
    }
  }
}`;

const GET_PRECONDITIONS = `query($projectId:String,$jql:String,$limit:Int!,$start:Int){
  getPreconditions(projectId:$projectId,jql:$jql,limit:$limit,start:$start){
    total
    results { issueId definition jira(fields:["key","summary"]) }
  }
}`;

// ponytail: the Jira projects this account sees, by name, a page of 100 at a time (the first launch picks one from them)
export async function listProjects(cap = 1000): Promise<{ key: string; name: string }[]> {
  const out: { key: string; name: string }[] = [];
  while (out.length < cap) {
    const p = await jiraFetch(
      "GET",
      `/rest/api/3/project/search?startAt=${out.length}&maxResults=100&orderBy=name`,
      undefined,
      "projects",
    );
    const values: Array<{ key: string; name?: string }> = p.values ?? [];
    for (const v of values) out.push({ key: v.key, name: v.name ?? v.key });
    if (p.isLast !== false || !values.length) break;
  }
  return out;
}

export async function getProjectInfo(key: string): Promise<ProjectInfo> {
  const p = await jiraFetch("GET", `/rest/api/3/project/${encodeURIComponent(key)}`, undefined, `project ${key}`);
  const types: Array<{ id: string; name: string }> = p.issueTypes ?? [];
  const t = types.find((x) => x.name === "Xray Test") ?? types.find((x) => x.name === "Test");
  if (!t) throw new Error(`Project ${p.key} has no "Xray Test" or "Test" issue type.`);
  return {
    id: String(p.id),
    key: p.key,
    name: p.name ?? p.key,
    testIssueTypeId: String(t.id),
    testIssueTypeName: t.name,
  };
}

type RawField = { id: string; name: string; type?: string; required?: boolean; disabled?: boolean };

// SPEC §10 (verified read-only on LFRPS12, 2026-11-02): the built-in three answer lowercase, a custom
// field answers under its own name; a field switched off in Xray is kept, marked disabled (Xray Editor
// shows it « off in Xray », folded unless a step holds something)
export async function getStepFields(projectId: string): Promise<XrayField[]> {
  const d = await gql<{ getProjectSettings: { testStepSettings?: { fields?: RawField[] } } | null }>(GET_STEP_FIELDS, {
    projectIdOrKey: projectId,
  });
  const raw = d.getProjectSettings?.testStepSettings?.fields ?? [];
  const flags = (f?: RawField) => ({
    ...(f?.required ? { required: true } : {}),
    ...(f?.disabled ? { disabled: true } : {}),
  });
  const builtins = BUILTIN.map((b) => {
    const f = raw.find((x) => x.name.toLowerCase() === b.key);
    return { id: f?.id ?? b.key, name: b.name, type: f?.type ?? "text", builtin: true, ...flags(f) };
  });
  const custom = raw
    .filter((f) => !BUILTIN.some((b) => b.key === f.name.toLowerCase()))
    .map((f) => ({ id: String(f.id), name: f.name, type: f.type ?? "text", builtin: false, ...flags(f) }));
  return [...builtins, ...custom];
}

type RawFolder = { name?: string; path?: string; testsCount?: number; folders?: RawFolder[] };

const toFolder = (f: RawFolder): Folder => {
  const folders = (f.folders ?? []).map(toFolder);
  const testsCount = f.testsCount ?? 0;
  return {
    name: f.name || "/",
    path: f.path || "/",
    testsCount,
    totalCount: folders.reduce((n, c) => n + c.totalCount, testsCount),
    folders,
  };
};

export async function getFolderTree(projectId: string, path = "/"): Promise<Folder> {
  const missing = new Error(`Xray folder ${path} does not exist in this project.`);
  const d = await gql<{ getFolder: RawFolder | null }>(GET_FOLDER, { projectId, path }).catch((e: Error) => {
    throw /does(n't| not) exist/i.test(e.message) ? missing : e;
  });
  if (!d.getFolder) throw missing;
  return toFolder(d.getFolder);
}

type RawTest = {
  issueId: string;
  folder?: { path?: string } | null;
  jira?: { key?: string; summary?: string; status?: { name?: string }; labels?: string[] };
  steps?: Array<{ id?: string }>;
};

const toRef = (t: RawTest): RemoteTestRef => ({
  key: t.jira?.key ?? "",
  issueId: String(t.issueId),
  summary: t.jira?.summary ?? "",
  status: t.jira?.status?.name ?? "",
  labels: t.jira?.labels ?? [],
  folder: t.folder?.path ?? "",
  stepCount: (t.steps ?? []).length,
});

export async function listTests(
  projectId: string,
  query: TestQuery,
  page = 0,
): Promise<{ tests: RemoteTestRef[]; total: number }> {
  const scope =
    "jql" in query
      ? { jql: query.jql, projectId: null, folder: null }
      : { jql: null, projectId, folder: { path: query.folder || "/", includeDescendants: query.descendants ?? false } };
  const d = await gql<{ getTests: { total: number; results: RawTest[] } }>(GET_TESTS, {
    ...scope,
    limit: PAGE,
    start: page * PAGE,
  });
  return { tests: (d.getTests.results ?? []).map(toRef), total: d.getTests.total ?? 0 };
}

export async function allInFolder(projectId: string, folder: string, descendants: boolean): Promise<string[]> {
  const keys: string[] = [];
  for (let page = 0; ; page++) {
    const { tests, total } = await listTests(projectId, { folder, descendants }, page);
    keys.push(...tests.map((t) => t.key));
    if (!tests.length || keys.length >= total) return keys;
  }
}

type RawPrecondition = { issueId: string; definition?: string | null; jira?: { key?: string; summary?: string } };

const toPrecondition = (p: RawPrecondition): Precondition => ({
  key: p.jira?.key ?? "",
  issueId: String(p.issueId),
  summary: p.jira?.summary ?? "",
  definition: p.definition ?? "",
});

const byKey = (a: Precondition, b: Precondition) => a.key.localeCompare(b.key);

export async function preconditions(vars: Record<string, unknown>): Promise<{ list: Precondition[]; total: number }> {
  const d = await gql<{ getPreconditions: { total: number; results: RawPrecondition[] } }>(GET_PRECONDITIONS, {
    projectId: null,
    jql: null,
    limit: PAGE,
    start: 0,
    ...vars,
  });
  return {
    list: (d.getPreconditions.results ?? []).map(toPrecondition).sort(byKey),
    total: d.getPreconditions.total ?? 0,
  };
}

export async function listPreconditions(projectId: string): Promise<Precondition[]> {
  const first = await preconditions({ projectId });
  const rest: Precondition[] = [];
  for (let start = PAGE; start < first.total; start += PAGE)
    rest.push(...(await preconditions({ projectId, start })).list);
  return [...first.list, ...rest].sort(byKey);
}

export async function searchTests(projectId: string, text: string, projectKey = ""): Promise<RemoteTestRef[]> {
  const q = text.trim();
  const needle = q.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  // ponytail: an issue key is three questions at once — the test itself, a summary that names it, a
  // link that points at it — and one JQL answers all three; bare digits ask them about the open project
  const key = /^[0-9]+$/.test(q) && projectKey ? `${projectKey}-${q}` : ISSUE_KEY.test(q) ? q : "";
  const where = key
    ? `(key = ${key} OR summary ~ "${needle}" OR issue in linkedIssues("${key}"))`
    : `summary ~ "${needle}"`;
  const jql = `project = ${projectId} AND issuetype in ("Xray Test","Test") AND ${where}`;
  return (await listTests(projectId, { jql })).tests;
}

async function downloadAttachment(link: string, filename: string): Promise<Uint8Array> {
  const host = new URL(link).host;
  const xray = /(^|\.)xray\.cloud\.getxray\.app$/i.test(host);
  const headers: Record<string, string> = {};
  if (xray) headers.Authorization = `Bearer ${await xrayJwt()}`;
  else {
    let c: JiraCreds | null = null;
    try {
      c = jiraCreds();
    } catch {}
    if (c && new URL(c.base).host === host) headers.Authorization = basic(c);
  }
  let res = await send({ method: "GET", url: link, headers, binary: true, timeoutMs: 120000 });
  if (res.status === 401 && xray)
    res = await send({
      method: "GET",
      url: link,
      headers: { Authorization: `Bearer ${await xrayJwt(true)}` },
      binary: true,
      timeoutMs: 120000,
    });
  if (res.status === 429) throw new Error(RATE_LIMITED);
  if (res.status >= 400) throw new Error(`Could not download ${filename} (HTTP ${res.status})`);
  return res.bytes ?? new Uint8Array();
}

export async function remoteSteps(key: string): Promise<RawStep[]> {
  const d = await gql<{ getTests: { results: Array<{ steps?: RawStep[] }> } }>(GET_TEST_STEPS, { jql: `key = ${key}` });
  return d.getTests.results?.[0]?.steps ?? [];
}

export async function pullTest(key: string): Promise<PulledTest> {
  const [d, issue] = await Promise.all([
    gql<{
      getTests: {
        results: Array<Omit<RawTest, "steps"> & { steps?: RawStep[]; preconditions?: { results?: RawPrecondition[] } }>;
      };
    }>(GET_TEST_STEPS, { jql: `key = ${key}` }),
    jiraFetch(
      "GET",
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,labels,status,assignee,description,issuelinks`,
      undefined,
      `issue ${key}`,
    ),
  ]);
  const raw = d.getTests.results?.[0];
  if (!raw) throw new Error(`${key} is not an Xray test, or you are not allowed to see it.`);

  const images: PulledImage[] = [];
  const steps: Step[] = (raw.steps ?? []).map((s, stepIndex) =>
    readStep(s, (a, filename) => {
      const link = a.downloadLink ?? "";
      images.push({ stepIndex, remoteId: a.id, filename, download: () => downloadAttachment(link, filename) });
    }),
  );

  const f = issue?.fields ?? {};
  const covers: string[] = [];
  let clonedFrom: string | undefined;
  for (const l of f.issuelinks ?? []) {
    const out = l.outwardIssue?.key;
    if (!out) continue;
    if (l.type?.name === "Cloners") clonedFrom = out;
    else if (l.type?.name === "Test") covers.push(out);
  }

  const pre = (raw.preconditions?.results ?? []).map(toPrecondition).sort(byKey);

  return {
    issueId: String(raw.issueId),
    images,
    preconditions: pre,
    test: {
      key: raw.jira?.key ?? key,
      project: key.split("-")[0],
      summary: f.summary ?? "",
      folder: raw.folder?.path ?? "",
      labels: f.labels ?? [],
      status: f.status?.name,
      ...(f.assignee?.accountId
        ? { assignee: String(f.assignee.displayName ?? f.assignee.accountId), assigneeId: String(f.assignee.accountId) }
        : {}),
      description: adfToText(f.description),
      covers,
      clonedFrom,
      preconditions: pre.map((p) => p.key),
      review: "draft",
      steps,
      extra: {},
    },
  };
}
