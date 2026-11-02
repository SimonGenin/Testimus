import { env, gate, type HttpReq, type HttpRes } from "../env.ts";
import type {
  Folder,
  PlanOp,
  Precondition,
  ProjectInfo,
  RemoteTestRef,
  Review,
  Step,
  StepImage,
  Test,
  XrayField,
} from "../types.ts";
import { REVIEWS } from "../types.ts";
import { adfToText, textToAdf } from "./adf.ts";
import { type JiraCreds, jiraCreds, xrayCreds } from "./creds.ts";
import { hasRawEmbed, imageRef, mapRefs } from "./testfile.ts";

export type PulledImage = {
  stepIndex: number;
  remoteId: string;
  filename: string;
  download: () => Promise<Uint8Array>;
};
export type PulledTest = { test: Test; issueId: string; images: PulledImage[]; preconditions: Precondition[] };
export type TestQuery = { folder: string; descendants?: boolean } | { jql: string };
export type Myself = { accountId: string; displayName: string; emailAddress?: string };
export type PushOp = PlanOp & { run: () => Promise<void> };
export type PushPlan = { ops: PushOp[]; warnings: string[]; remoteChanged: boolean };
export type PushDeps = {
  project: ProjectInfo;
  accountId: string;
  readImage: (file: string) => Promise<Uint8Array>;
  fields: XrayField[];
  labelPrefix: string;
  remoteChanged?: boolean;
};
export type StepSync = { mode: "in-place"; remove: string[]; update: number[]; add: number[] } | { mode: "rebuild" };
export type BulkTest = { summary: string; folder: string; description: string; labels: string[]; steps: Step[] };
export type ImportStatus = {
  status: string;
  issues: Array<{ key: string; id: string }>;
  errors: string[];
  warnings: string[];
};

export const PAGE = 100;
const ATTACHMENT_MARKER = /!xray-attachment:\/\/([^!\n|]+)(?:\|([^!\n]*))?!/g;

// The three step fields Xray builds in, under the name test.md gives them and the key the API uses.
// SPEC §10: getProjectSettings lists them lowercase (action/data/result), everything else is custom.
export const BUILTIN = [
  { name: "Action", key: "action" },
  { name: "Data", key: "data" },
  { name: "Expected Result", key: "result" },
] as const;
type BuiltinKey = (typeof BUILTIN)[number]["key"];

let jwt = "";
let jwtFor = "";
let myselfCache: Myself | null = null;
let myselfFor = "";

export function resetAuth(): void {
  jwt = "";
  jwtFor = "";
  myselfCache = null;
  myselfFor = "";
}

export const browseUrl = (key: string) => `${jiraCreds().base}/browse/${key}`;

const basic = (c: JiraCreds) => `Basic ${Buffer.from(`${c.email}:${c.token}`).toString("base64")}`;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

// ponytail: Xray Cloud and Jira both meter the API and answer 429 — every request goes through here, so
// the whole backoff is one function: never more than six calls in the air, and a 429 is waited out for
// exactly as long as the server asks (Retry-After, seconds or an HTTP date) before being sent again.
// Nothing else is retried; a request still refused fails, and pushes resume from where they stopped.
const MAX_WAIT = 120;
const httpSlot = gate(6);

export const rateLimit = { onWait: (_secs: number) => {} };

const headerOf = (h: Record<string, string>, name: string) =>
  h[name] ?? h[Object.keys(h).find((k) => k.toLowerCase() === name) ?? ""] ?? "";

export function retryAfter(headers: Record<string, string>, attempt: number): number {
  const raw = headerOf(headers, "retry-after").trim();
  const secs = Number(raw);
  if (raw && Number.isFinite(secs)) return Math.min(Math.max(secs, 0), MAX_WAIT);
  const at = raw ? Date.parse(raw) : Number.NaN;
  if (!Number.isNaN(at)) return Math.min(Math.max(Math.ceil((at - Date.now()) / 1000), 1), MAX_WAIT);
  return Math.min(5 * 2 ** attempt, MAX_WAIT);
}

async function send(req: HttpReq): Promise<HttpRes> {
  return httpSlot(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await env.http(req);
      if (res.status !== 429 || attempt === 3) return res;
      const secs = retryAfter(res.headers, attempt);
      // ponytail: the wait holds its slot on purpose — being rate limited must slow everything down
      rateLimit.onWait(secs);
      await new Promise((r) => setTimeout(r, secs * 1000));
    }
  });
}

export const RATE_LIMITED =
  "Xray/Jira rate limit reached and still refusing after three waits. Everything already applied stays — try again in a minute.";

async function jiraFetch(method: string, path: string, body?: unknown, what = path): Promise<any> {
  const c = jiraCreds();
  const res = await send({
    method,
    url: c.base + path,
    headers: {
      Authorization: basic(c),
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs: 60000,
  });
  if (res.status === 401 || res.status === 403)
    throw new Error(`Jira ${res.status} — check ~/.atlassian/credentials.json`);
  if (res.status === 404) throw new Error(`Jira 404 — ${what} not found`);
  if (res.status === 429) throw new Error(RATE_LIMITED);
  if (res.status >= 400) throw new Error(`Jira ${res.status} on ${what} — ${(res.text ?? "").slice(0, 300)}`);
  return res.text ? JSON.parse(res.text) : null;
}

async function xrayJwt(force = false): Promise<string> {
  const c = xrayCreds();
  const who = `${c.apiBase}|${c.clientId}`;
  if (jwt && jwtFor === who && !force) return jwt;
  const res = await send({
    method: "POST",
    url: `${c.apiBase}/api/v2/authenticate`,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret }),
    timeoutMs: 60000,
  });
  if (res.status === 401) throw new Error("Xray 401 — check ~/.atlassian/xray_credentials.json (client id / secret)");
  if (res.status >= 400)
    throw new Error(`Xray authentication failed (${res.status}) — ${(res.text ?? "").slice(0, 200)}`);
  jwt = (res.text ?? "").trim().replace(/^"|"$/g, "");
  jwtFor = who;
  if (!jwt) throw new Error("Xray authentication returned an empty token.");
  return jwt;
}

async function xrayFetch(method: string, path: string, body?: unknown): Promise<any> {
  const c = xrayCreds();
  const call = (token: string) =>
    send({
      method,
      url: `${c.apiBase}${path}`,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs: 120000,
    });
  let res = await call(await xrayJwt());
  if (res.status === 401) res = await call(await xrayJwt(true));
  if (res.status === 401) throw new Error("Xray 401 — check ~/.atlassian/xray_credentials.json");
  if (res.status === 429) throw new Error(RATE_LIMITED);
  if (res.status >= 400) throw new Error(`Xray ${res.status} on ${path} — ${(res.text ?? "").slice(0, 300)}`);
  return res.text ? JSON.parse(res.text) : null;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const c = xrayCreds();
  const call = (token: string) =>
    send({
      method: "POST",
      url: `${c.apiBase}/api/v2/graphql`,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
      timeoutMs: 120000,
    });
  let res = await call(await xrayJwt());
  if (res.status === 401) res = await call(await xrayJwt(true));
  if (res.status === 401) throw new Error("Xray 401 — check ~/.atlassian/xray_credentials.json");
  if (res.status === 429) throw new Error(RATE_LIMITED);
  if (res.status >= 400) throw new Error(`Xray GraphQL ${res.status} — ${(res.text ?? "").slice(0, 300)}`);
  const body = JSON.parse(res.text ?? "{}");
  if (body.errors?.length)
    throw new Error(`Xray: ${body.errors.map((e: { message?: string }) => e.message ?? "error").join("; ")}`);
  return body.data as T;
}

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

type RawField = { id: string; name: string; type?: string; disabled?: boolean };

// SPEC §10 (verified read-only on LFRPS12, 2026-11-02): the built-in three answer lowercase, a custom
// field answers under its own name; a disabled field is not offered in Xray, so it is not offered here
export async function getStepFields(projectId: string): Promise<XrayField[]> {
  const d = await gql<{ getProjectSettings: { testStepSettings?: { fields?: RawField[] } } | null }>(GET_STEP_FIELDS, {
    projectIdOrKey: projectId,
  });
  const raw = (d.getProjectSettings?.testStepSettings?.fields ?? []).filter((f) => !f.disabled);
  const builtins = BUILTIN.map((b) => {
    const f = raw.find((x) => x.name.toLowerCase() === b.key);
    return { id: f?.id ?? b.key, name: b.name, type: f?.type ?? "text", builtin: true };
  });
  const custom = raw
    .filter((f) => !BUILTIN.some((b) => b.key === f.name.toLowerCase()))
    .map((f) => ({ id: String(f.id), name: f.name, type: f.type ?? "text", builtin: false }));
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
  const d = await gql<{ getFolder: RawFolder | null }>(GET_FOLDER, { projectId, path });
  if (!d.getFolder) throw new Error(`Xray folder ${path} does not exist in this project.`);
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

type RawPrecondition = { issueId: string; definition?: string | null; jira?: { key?: string; summary?: string } };

const toPrecondition = (p: RawPrecondition): Precondition => ({
  key: p.jira?.key ?? "",
  issueId: String(p.issueId),
  summary: p.jira?.summary ?? "",
  definition: p.definition ?? "",
});

const byKey = (a: Precondition, b: Precondition) => a.key.localeCompare(b.key);

async function preconditions(vars: Record<string, unknown>): Promise<{ list: Precondition[]; total: number }> {
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

export const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9]*-[0-9]+$/;

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

const safeName = (s: string) => (s || "image.png").replace(/[^A-Za-z0-9._-]+/g, "_");

// ponytail: Xray refuses a step without an action, and an empty action is legitimate here — so it goes
// up holding one zero-width space, and is stripped again on the way back so the local file stays empty
const BLANK = "​";
const orBlank = (text: string) => (text.trim() ? text : BLANK);

const base = (file: string) => file.split(/[\\/]/).pop() || file;

const toRefs = (text: string, images: StepImage[]) =>
  (text ?? "").replace(/\r\n?/g, "\n").replace(ATTACHMENT_MARKER, (m, id: string, params?: string) => {
    const im = images.find((x) => x.remoteId === id);
    return im && !params?.includes('"') ? imageRef(im.file, params ?? "") : m;
  });

const toMarkers = (text: string, ids: Map<string, string>) =>
  mapRefs(text, (file, params, ref) => {
    const id = ids.get(file);
    return id === undefined ? ref : id ? `!xray-attachment://${id}${params ? `|${params}` : ""}!` : "";
  });

const fieldOf = (s: Step, name: string) => s.fields[name] ?? "";

const refsIn = (s: Step) => {
  const files: string[] = [];
  mapRefs(BUILTIN.map((b) => fieldOf(s, b.name)).join("\n"), (file) => {
    files.push(file);
    return "";
  });
  return files.filter((f) => s.images.some((im) => im.file === f));
};

export const byId = (text: string, images: StepImage[]) =>
  mapRefs(text, (file, params) => imageRef(images.find((im) => im.file === file)?.remoteId ?? file, params));

const knownIds = (s: Step) => new Map(s.images.map((im) => [im.file, im.remoteId ?? ""]));

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

// Custom step fields, read and written (SPEC §10, verified read-only on LFRPS12-327, 2026-11-02):
// read `customFields { id name value }` (value is a JSON scalar), write `customFields: [{ id, value }]`
// in CreateStepInput / UpdateStepInput. This pair of functions is the only place that knows the shape.
type RawCustom = { id: string; name?: string; value?: unknown };

const customText = (v: unknown): string =>
  v == null
    ? ""
    : Array.isArray(v)
      ? v.map(customText).join(", ")
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);

function readCustom(list: RawCustom[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of list ?? []) {
    const v = customText(c.value).replace(/\r\n?/g, "\n");
    if (v) out[c.name || c.id] = v;
  }
  return out;
}

function customInput(
  s: Step,
  schema: XrayField[],
  only?: (name: string) => boolean,
): Array<{ id: string; value: string }> {
  return schema
    .filter((f) => !f.builtin && (only ? only(f.name) : !!fieldOf(s, f.name)))
    .map((f) => ({ id: f.id, value: fieldOf(s, f.name) }));
}

type RawStep = {
  id: string;
  action?: string | null;
  data?: string | null;
  result?: string | null;
  customFields?: RawCustom[];
  attachments?: Array<{ id: string; filename?: string; downloadLink?: string }>;
};

export async function pullTest(key: string): Promise<PulledTest> {
  const [d, issue] = await Promise.all([
    gql<{
      getTests: {
        results: Array<Omit<RawTest, "steps"> & { steps?: RawStep[]; preconditions?: { results?: RawPrecondition[] } }>;
      };
    }>(GET_TEST_STEPS, { jql: `key = ${key}` }),
    jiraFetch(
      "GET",
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,labels,status,description,issuelinks`,
      undefined,
      `issue ${key}`,
    ),
  ]);
  const raw = d.getTests.results?.[0];
  if (!raw) throw new Error(`${key} is not an Xray test, or you are not allowed to see it.`);

  const images: PulledImage[] = [];
  const steps: Step[] = (raw.steps ?? []).map((s, stepIndex) => {
    const stepImages: StepImage[] = (s.attachments ?? []).map((a) => {
      const filename = safeName(a.filename ?? a.id);
      const link = a.downloadLink ?? "";
      images.push({ stepIndex, remoteId: a.id, filename, download: () => downloadAttachment(link, filename) });
      // ponytail: the placeholder is keyed by the attachment id — Jira holds five "image.png" in one step
      return { file: `images/${a.id}-${filename}`, remoteId: a.id };
    });
    const builtin: Record<BuiltinKey, string> = {
      action: toRefs((s.action ?? "").split(BLANK).join(""), stepImages),
      data: toRefs(s.data ?? "", stepImages),
      result: toRefs(s.result ?? "", stepImages),
    };
    const fields: Record<string, string> = {};
    for (const b of BUILTIN) fields[b.name] = builtin[b.key];
    Object.assign(fields, readCustom(s.customFields));
    return { id: s.id, fields, sources: [], images: stepImages };
  });

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

export async function getMyself(): Promise<Myself> {
  const who = jiraCreds().email;
  if (myselfCache && myselfFor === who) return myselfCache;
  const m = await jiraFetch("GET", "/rest/api/3/myself", undefined, "your Jira account");
  myselfFor = who;
  myselfCache = { accountId: m.accountId, displayName: m.displayName, emailAddress: m.emailAddress };
  return myselfCache;
}

// The review state travels as one label: `<prefix><review>`, replacing any other review label of
// the same prefix; other labels, the team's own `<prefix>…` ones included, are left as they are.
// ponytail: an empty prefix would make `draft`, `validated`… — the team's own labels — ours to replace,
// and Jira labels hold no space: either falls back to the default
export const DEFAULT_LABEL_PREFIX = "testimus-";
export const labelPrefixOf = (prefix: string) => (prefix && !/\s/.test(prefix) ? prefix : DEFAULT_LABEL_PREFIX);

export function reviewLabels(labels: string[], review: Review, prefix: string): string[] {
  const p = labelPrefixOf(prefix);
  const own = new Set(REVIEWS.map((r) => p + r));
  return [...labels.filter((l) => !own.has(l)), p + review];
}

export function reviewOfLabels(labels: string[], prefix: string): Review | undefined {
  const p = labelPrefixOf(prefix);
  return REVIEWS.find((r) => labels.includes(p + r));
}

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

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

export const mimeOf = (file: string) =>
  MIME[/\.([A-Za-z0-9]+)$/.exec(file)?.[1].toLowerCase() ?? ""] ?? "application/octet-stream";

async function attachmentInput(file: string, read: PushDeps["readImage"]) {
  const filename = base(file);
  const bytes = await read(file).catch(() => {
    throw new Error(`${file} is missing from the test folder — remove it from the step or add the screenshot again.`);
  });
  return { filename, mimeType: mimeOf(filename), data: b64(bytes) };
}

const stepInput = async (s: Step, read: PushDeps["readImage"], schema: XrayField[]) => {
  const none = new Map(s.images.map((im) => [im.file, ""]));
  const action = toMarkers(fieldOf(s, "Action"), none);
  const custom = customInput(s, schema);
  return {
    action: action.trim() ? action : orBlank(fieldOf(s, "Action")),
    data: toMarkers(fieldOf(s, "Data"), none),
    result: toMarkers(fieldOf(s, "Expected Result"), none),
    attachments: await Promise.all(s.images.map((im) => attachmentInput(im.file, read))),
    ...(custom.length ? { customFields: custom } : {}),
  };
};

// The Xray bulk import's JSON (POST /api/v2/import/test/bulk). VERIFY: custom step fields in the bulk
// payload are sent as `customFields: [{ id, value }]` per step, like the GraphQL step inputs — unproven.
export function bulkTestJson(t: BulkTest, project: ProjectInfo, schema: XrayField[]) {
  const fields: Record<string, unknown> = { summary: t.summary, project: { key: project.key } };
  if (t.labels.length) fields.labels = t.labels;
  if (t.description.trim()) fields.description = t.description;
  return {
    testtype: "Manual",
    fields,
    ...(t.folder ? { xray_test_repository_folder: t.folder } : {}),
    steps: t.steps.map((s) => {
      const custom = customInput(s, schema);
      return {
        action: orBlank(fieldOf(s, "Action")),
        data: fieldOf(s, "Data"),
        result: fieldOf(s, "Expected Result"),
        ...(custom.length ? { customFields: custom } : {}),
      };
    }),
  };
}

export async function startBulkImport(tests: unknown[]): Promise<string> {
  const r = await xrayFetch("POST", "/api/v2/import/test/bulk", tests);
  if (!r?.jobId) throw new Error("Xray bulk import answered without a job id.");
  return String(r.jobId);
}

export async function bulkImportStatus(jobId: string): Promise<ImportStatus> {
  const r = await xrayFetch("GET", `/api/v2/import/test/bulk/${encodeURIComponent(jobId)}/status`);
  const res = r?.result ?? {};
  const msg = (e: any) => (typeof e === "string" ? e : JSON.stringify(e?.errors ?? e));
  return {
    status: String(r?.status ?? "unknown"),
    issues: (res.issues ?? []).map((i: any) => ({ key: String(i.key), id: String(i.id) })),
    errors: (res.errors ?? []).map(msg),
    warnings: (res.warnings ?? []).map(msg),
  };
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function imageOps(local: StepImage[], remote: StepImage[]) {
  const remoteIds = remote.map((im) => im.remoteId ?? "");
  const kept = local.flatMap((im) => (im.remoteId ? [im.remoteId] : []));
  const lastKnown = local.map((im) => !!im.remoteId).lastIndexOf(true);
  const appended = !local.some((im, i) => !im.remoteId && i < lastKnown);
  const ordered = same(
    remoteIds.filter((id) => kept.includes(id)),
    kept,
  );
  if (appended && ordered)
    return { add: local.filter((im) => !im.remoteId), removeIds: remoteIds.filter((id) => !kept.includes(id)) };
  return { add: local, removeIds: remoteIds };
}

const link = (type: string, from: string, to: string) =>
  jiraFetch(
    "POST",
    "/rest/api/3/issueLink",
    { type: { name: type }, inwardIssue: { key: from }, outwardIssue: { key: to } },
    `link ${type} ${from} to ${to}`,
  ).then(() => undefined);

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
  const unknown = [...new Set(local.steps.flatMap((s) => Object.keys(s.fields).filter((n) => !known.has(n))))];
  if (unknown.length)
    warnings.push(
      `${unknown.map((n) => `"${n}"`).join(", ")} ${unknown.length > 1 ? "are not step fields" : "is not a step field"} of ${deps.project.key} — not pushed (refresh the fields with xray.fields if it was just added).`,
    );

  const labels = reviewLabels(local.labels, local.review, deps.labelPrefix);
  const unreadable = local.steps.flatMap((s, i) => (hasRawEmbed(s) ? [i + 1] : []));

  // ponytail: only an answer worth having is kept — a failed or index-lagged fetch is made again on retry
  let fetched: RawStep[] = [];
  const remoteSteps = async () => {
    if (fetched.length) return fetched;
    const d = await gql<{ getTests: { results: Array<{ steps?: RawStep[] }> } }>(GET_TEST_STEPS, {
      jql: `key = ${local.key}`,
    });
    fetched = d.getTests.results?.[0]?.steps ?? [];
    return fetched;
  };

  const embedOp = (i: number) => {
    const n = new Set(refsIn(local.steps[i])).size;
    embeds.push({
      label: `Embed ${n} image${n > 1 ? "s" : ""} in step ${i + 1}`,
      kind: "embed",
      run: async () => {
        const rs = (await remoteSteps())[i];
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

  const plural = (n: number) => (n > 1 ? "s" : "");

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
