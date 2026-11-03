import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env, type HttpReq, type HttpRes } from "../../src/core/env.ts";
import {
  getFolderTree,
  getMyself,
  getProjectInfo,
  getStepFields,
  listPreconditions,
  listTests,
  mimeOf,
  type PulledTest,
  planPush,
  pullTest,
  rateLimit,
  resetAuth,
  reviewOfLabels,
  searchTests,
} from "../../src/core/lib/jira.ts";
import type { Precondition, Step, StepImage, Test, XrayField } from "../../src/core/types.ts";

const JIRA = "https://t.atlassian.net";
const XRAY = "https://xray.cloud.getxray.app";

type Call = { method: string; url: string; headers: Record<string, string>; body: any };
let calls: Call[] = [];
let route: (req: HttpReq, body: any) => HttpRes | undefined = () => undefined;
let graph: (query: string, vars: any) => unknown = () => ({});
let authText: string | undefined = '"jwt-1"';
let authStatus = 200;

const ok = (body: unknown, status = 200): HttpRes => ({ status, headers: {}, text: JSON.stringify(body) });
const status = (s: number, text?: string): HttpRes => ({ status: s, headers: { "retry-after": "0" }, text });
const gqlCalls = () => calls.filter((c) => c.url.endsWith("/graphql"));

const http = env.http;
const onWait = rateLimit.onWait;
afterAll(() => {
  env.http = http;
  rateLimit.onWait = onWait;
});

function writeCreds(jira: unknown = { baseUrl: JIRA, email: "me@x.com", token: "tok" }) {
  const dir = join(env.homeDir(), ".atlassian");
  mkdirSync(dir, { recursive: true });
  if (jira === null) rmSync(join(dir, "credentials.json"), { force: true });
  else writeFileSync(join(dir, "credentials.json"), JSON.stringify(jira));
  writeFileSync(join(dir, "xray_credentials.json"), JSON.stringify({ clientId: "cid", clientSecret: "sec" }));
}

beforeEach(() => {
  calls = [];
  route = () => undefined;
  graph = () => ({});
  authText = '"jwt-1"';
  authStatus = 200;
  rateLimit.onWait = () => {};
  resetAuth();
  writeCreds();
  env.http = async (req: HttpReq): Promise<HttpRes> => {
    const body = req.body ? JSON.parse(req.body) : undefined;
    calls.push({ method: req.method, url: req.url, headers: req.headers ?? {}, body });
    const r = route(req, body);
    if (r) return r;
    if (req.url.includes("/api/v2/authenticate")) return { status: authStatus, headers: {}, text: authText };
    if (req.url.endsWith("/graphql")) return ok({ data: graph(body.query, body.variables) });
    return ok({});
  };
});

describe("jira REST errors", () => {
  it("a 429 still refused after three waits fails with the rate limit message", async () => {
    route = (req) => (req.url.startsWith(JIRA) ? status(429) : undefined);
    await expect(getMyself()).rejects.toThrow(/rate limit/);
    expect(calls).toHaveLength(4);
  });

  it("another error status quotes the answer, or nothing when there is none", async () => {
    route = (req) => (req.url.startsWith(JIRA) ? status(500) : undefined);
    await expect(getMyself()).rejects.toThrow(/^Jira 500 on your Jira account — $/);
    route = (req) => (req.url.startsWith(JIRA) ? status(400, "bad") : undefined);
    await expect(getProjectInfo("X")).rejects.toThrow("Jira 400 on project X — bad");
  });

  it("an empty answer reads as null", async () => {
    route = (req) => (req.url.startsWith(JIRA) ? status(200, "") : undefined);
    await expect(getMyself()).rejects.toThrow(TypeError);
  });

  it("a 403 names the Jira credentials file", async () => {
    route = (req) => (req.url.startsWith(JIRA) ? status(403, "forbidden") : undefined);
    await expect(getMyself()).rejects.toThrow(/^Jira 403 — check ~\/\.atlassian\/credentials\.json$/);
    expect(calls).toHaveLength(1);
  });

  it("never has more than six requests in the air", async () => {
    const held: ((r: HttpRes) => void)[] = [];
    env.http = (req) => {
      calls.push({ method: req.method, url: req.url, headers: req.headers ?? {}, body: undefined });
      return new Promise<HttpRes>((r) => held.push(r));
    };
    const tick = async () => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    };
    const all = Array.from({ length: 8 }, () => {
      resetAuth();
      return getMyself();
    });
    await tick();
    expect(held).toHaveLength(6);
    held[0](ok({ accountId: "a", displayName: "A" }));
    await tick();
    expect(held).toHaveLength(7);
    for (let i = 1; i < held.length; i++) held[i](ok({ accountId: "a", displayName: "A" }));
    await tick();
    expect(held).toHaveLength(8);
    for (const r of held) r(ok({ accountId: "a", displayName: "A" }));
    await Promise.all(all);
  });

  it("getMyself is cached per account", async () => {
    route = (req) => (req.url.endsWith("/myself") ? ok({ accountId: "a1", displayName: "Me" }) : undefined);
    const a = await getMyself();
    const b = await getMyself();
    expect(b).toBe(a);
    expect(calls).toHaveLength(1);
  });
});

describe("xray authentication", () => {
  it("a 401 names the xray credentials file", async () => {
    authStatus = 401;
    await expect(getFolderTree("1")).rejects.toThrow("Xray 401 — check ~/.atlassian/xray_credentials.json (client id");
  });

  it("another failure quotes the answer, empty or not", async () => {
    authStatus = 500;
    authText = undefined;
    await expect(getFolderTree("1")).rejects.toThrow(/^Xray authentication failed \(500\) — $/);
    authText = "down";
    await expect(getFolderTree("1")).rejects.toThrow("Xray authentication failed (500) — down");
  });

  it("an empty token is refused", async () => {
    authText = '""';
    await expect(getFolderTree("1")).rejects.toThrow("empty token");
    authText = undefined;
    await expect(getFolderTree("1")).rejects.toThrow("empty token");
  });
});

describe("xray token", () => {
  it("is fetched once and reused across calls, and fetched again only after a 401", async () => {
    const tree = { getFolder: { name: "/", path: "/", testsCount: 0, folders: [] } };
    graph = () => tree;
    const auths = () => calls.filter((c) => c.url.includes("/api/v2/authenticate")).length;
    const bearers = () => gqlCalls().map((c) => c.headers.Authorization);
    await getFolderTree("1");
    await getFolderTree("1");
    await getFolderTree("1");
    expect(auths()).toBe(1);
    expect(bearers()).toEqual(["Bearer jwt-1", "Bearer jwt-1", "Bearer jwt-1"]);
    let refused = false;
    authText = '"jwt-2"';
    route = (req) => {
      if (!req.url.endsWith("/graphql") || refused) return undefined;
      refused = true;
      return status(401);
    };
    await getFolderTree("1");
    expect(auths()).toBe(2);
    await getFolderTree("1");
    expect(auths()).toBe(2);
    expect(bearers().slice(3)).toEqual(["Bearer jwt-1", "Bearer jwt-2", "Bearer jwt-2"]);
  });
});

describe("graphql errors", () => {
  it("two 401 in a row fail", async () => {
    route = (req) => (req.url.endsWith("/graphql") ? status(401) : undefined);
    await expect(getFolderTree("1")).rejects.toThrow("Xray 401 — check ~/.atlassian/xray_credentials.json");
    expect(calls.filter((c) => c.url.includes("authenticate"))).toHaveLength(2);
  });

  it("a 429 that does not go away fails with the rate limit message", async () => {
    let waits = 0;
    rateLimit.onWait = () => waits++;
    route = (req) => (req.url.endsWith("/graphql") ? status(429) : undefined);
    await expect(getFolderTree("1")).rejects.toThrow(/rate limit/);
    expect(waits).toBe(3);
  });

  it("a server error quotes the answer, empty or not", async () => {
    route = (req) => (req.url.endsWith("/graphql") ? status(502) : undefined);
    await expect(getFolderTree("1")).rejects.toThrow(/^Xray GraphQL 502 — $/);
  });

  it("errors in the body are joined, an error without message says error", async () => {
    route = (req) => (req.url.endsWith("/graphql") ? ok({ errors: [{ message: "a" }, {}] }) : undefined);
    await expect(getFolderTree("1")).rejects.toThrow("Xray: a; error");
  });

  it("an empty body reads as no data", async () => {
    route = (req) => (req.url.endsWith("/graphql") ? status(200) : undefined);
    await expect(getFolderTree("1")).rejects.toThrow(TypeError);
  });
});

describe("read paths, sparse answers", () => {
  it("getProjectInfo falls back to the Test type and to the key as name", async () => {
    route = (req) =>
      req.url.includes("/project/")
        ? ok({
            id: 5,
            key: "P",
            issueTypes: [
              { id: 1, name: "Bug" },
              { id: 2, name: "Test" },
            ],
          })
        : undefined;
    expect(await getProjectInfo("P")).toEqual({
      id: "5",
      key: "P",
      name: "P",
      testIssueTypeId: "2",
      testIssueTypeName: "Test",
    });
  });

  it("getProjectInfo refuses a project without a test type", async () => {
    route = (req) => (req.url.includes("/project/") ? ok({ id: 5, key: "P" }) : undefined);
    await expect(getProjectInfo("P")).rejects.toThrow('Project P has no "Xray Test" or "Test" issue type.');
  });

  it("getStepFields without settings gives the built-in three, typed text", async () => {
    graph = () => ({ getProjectSettings: null });
    expect((await getStepFields("1")).map((f) => [f.id, f.type])).toEqual([
      ["action", "text"],
      ["data", "text"],
      ["result", "text"],
    ]);
    graph = () => ({ getProjectSettings: {} });
    expect(await getStepFields("1")).toHaveLength(3);
    graph = () => ({
      getProjectSettings: {
        testStepSettings: {
          fields: [
            { id: 9, name: "Note" },
            { id: 10, name: "Off", disabled: true },
          ],
        },
      },
    });
    expect((await getStepFields("1")).slice(3)).toEqual([
      { id: "9", name: "Note", type: "text", builtin: false },
      { id: "10", name: "Off", type: "text", builtin: false, disabled: true },
    ]);
  });

  it("getFolderTree names an empty folder / and refuses a missing one", async () => {
    graph = () => ({ getFolder: {} });
    expect(await getFolderTree("1")).toEqual({ name: "/", path: "/", testsCount: 0, totalCount: 0, folders: [] });
    graph = () => ({ getFolder: null });
    await expect(getFolderTree("1", "/Nope")).rejects.toThrow("Xray folder /Nope does not exist");
  });

  it("listTests reads a bare result, and asks the root folder without descendants by default", async () => {
    graph = () => ({ getTests: { results: [{ issueId: 3 }] } });
    expect(await listTests("1", { folder: "" })).toEqual({
      tests: [{ key: "", issueId: "3", summary: "", status: "", labels: [], folder: "", stepCount: 0 }],
      total: 0,
    });
    expect(gqlCalls()[0].body.variables.folder).toEqual({ path: "/", includeDescendants: false });
    graph = () => ({ getTests: {} });
    expect(await listTests("1", { jql: "x" })).toEqual({ tests: [], total: 0 });
  });

  it("listPreconditions pages past the first hundred and sorts by key", async () => {
    graph = (_q, v) =>
      v.start === 0
        ? { getPreconditions: { total: 150, results: [{ issueId: 2, jira: { key: "P-2" } }] } }
        : v.start === 100
          ? { getPreconditions: { total: 150, results: [{ issueId: 1, jira: { key: "P-1", summary: "s" } }] } }
          : { getPreconditions: {} };
    const list = await listPreconditions("1");
    expect(list.map((p) => p.key)).toEqual(["P-1", "P-2"]);
    expect(list[1]).toEqual({ key: "P-2", issueId: "2", summary: "", definition: "" });
    expect(gqlCalls()).toHaveLength(2);
    graph = () => ({ getPreconditions: {} });
    expect(await listPreconditions("1")).toEqual([]);
  });

  it("searchTests escapes backslashes and keeps bare digits as text without a project key", async () => {
    graph = () => ({ getTests: { total: 0, results: [] } });
    await searchTests("1", ' a\\b"c ');
    expect(gqlCalls()[0].body.variables.jql).toContain('summary ~ "a\\\\b\\"c"');
    await searchTests("1", "42");
    expect(gqlCalls()[1].body.variables.jql).toMatch(/AND summary ~ "42"$/);
  });
});

describe("pullTest, sparse and odd answers", () => {
  it("refuses a key that is not a test", async () => {
    graph = () => ({ getTests: {} });
    await expect(pullTest("P-1")).rejects.toThrow("P-1 is not an Xray test");
  });

  it("reads a bare test: no steps, no fields, no links", async () => {
    graph = () => ({ getTests: { results: [{ issueId: 8 }] } });
    route = (req) => (req.url.includes("/issue/") ? status(200, "") : undefined);
    const p = await pullTest("P-1");
    expect(p.issueId).toBe("8");
    expect(p.test).toMatchObject({ key: "P-1", project: "P", summary: "", folder: "", labels: [], covers: [] });
    expect(p.test.status).toBeUndefined();
    expect(p.test.clonedFrom).toBeUndefined();
  });

  it("reads custom values of every kind, attachments without names, and skips links without an outward issue", async () => {
    graph = () => ({
      getTests: {
        results: [
          {
            issueId: 8,
            jira: { key: "P-1" },
            steps: [
              {
                id: "s1",
                action: null,
                data: null,
                result: null,
                customFields: [
                  { id: "c1", name: "List", value: ["a", 1, null] },
                  { id: "c2", value: { k: 1 } },
                  { id: "c3", name: "Empty", value: null },
                  { id: "c4", name: "Lines", value: "a\r\nb\rc" },
                ],
                attachments: [{ id: "att 1" }],
              },
              {
                id: "s2",
                action: 'x !xray-attachment://att-2|alt="q"! !xray-attachment://nope! !xray-attachment://att-2|w=1!',
                attachments: [{ id: "att-2", filename: "shot one.png", downloadLink: `${XRAY}/dl/2` }],
              },
            ],
          },
        ],
      },
    });
    route = (req) =>
      req.url.includes("/issue/")
        ? ok({
            fields: {
              summary: "S",
              status: { name: "Open" },
              issuelinks: [
                { type: { name: "Test" }, inwardIssue: { key: "P-9" } },
                { type: { name: "Cloners" }, outwardIssue: { key: "P-5" } },
                { type: { name: "Relates" }, outwardIssue: { key: "P-6" } },
                { outwardIssue: { key: "P-7" } },
              ],
            },
          })
        : undefined;
    const p = await pullTest("P-1");
    const [s1, s2] = p.test.steps;
    expect(s1.fields).toEqual({
      Action: "",
      Data: "",
      "Expected Result": "",
      List: JSON.stringify(["a", 1, null]),
      Lines: "a\nb\nc",
    });
    expect(s1.images).toEqual([{ file: "images/att 1-att_1", remoteId: "att 1" }]);
    expect(p.images[0].filename).toBe("att_1");
    expect(s2.fields.Action).toBe(
      'x !xray-attachment://att-2|alt="q"! !xray-attachment://nope! ![](images/att-2-shot_one.png "w=1")',
    );
    expect(p.test.clonedFrom).toBe("P-5");
    expect(p.test.covers).toEqual([]);
    expect(p.test.status).toBe("Open");
  });
});

describe("attachment downloads", () => {
  const pulled = async (link?: string) => {
    graph = () => ({
      getTests: {
        results: [
          { issueId: 1, steps: [{ id: "s", attachments: [{ id: "a", filename: "f.png", downloadLink: link }] }] },
        ],
      },
    });
    route = (req) => (req.url.includes("/issue/") ? ok({ fields: {} }) : undefined);
    return (await pullTest("P-1")).images[0];
  };

  it("re-authenticates once when the Xray host answers 401", async () => {
    const im = await pulled(`${XRAY}/dl/a`);
    let n = 0;
    const base = env.http;
    env.http = async (req) =>
      req.binary ? (n++ === 0 ? status(401) : { status: 200, headers: {}, bytes: new Uint8Array([1]) }) : base(req);
    expect(await im.download()).toEqual(new Uint8Array([1]));
    expect(n).toBe(2);
  });

  it("sends no credentials to a third host, nor when Jira credentials are missing", async () => {
    const im = await pulled("https://cdn.example.com/a");
    const seen: Array<Record<string, string>> = [];
    const base = env.http;
    env.http = async (req) => {
      if (!req.binary) return base(req);
      seen.push(req.headers ?? {});
      return { status: 200, headers: {} };
    };
    expect(await im.download()).toEqual(new Uint8Array());
    writeCreds(null);
    const again = await pulledAfterCredsGone(im);
    expect(again).toEqual(new Uint8Array());
    expect(seen.every((h) => !h.Authorization)).toBe(true);
  });

  const pulledAfterCredsGone = async (im: { download: () => Promise<Uint8Array> }) => im.download();

  it("a 429 fails with the rate limit message, another error names the file", async () => {
    const im = await pulled(`${JIRA}/secure/a`);
    const base = env.http;
    env.http = async (req) => (req.binary ? status(429) : base(req));
    await expect(im.download()).rejects.toThrow(/rate limit/);
    env.http = async (req) => (req.binary ? status(404) : base(req));
    await expect(im.download()).rejects.toThrow("Could not download f.png (HTTP 404)");
  });

  it("a link missing from the answer cannot be downloaded", async () => {
    const im = await pulled(undefined);
    await expect(im.download()).rejects.toThrow();
  });
});

describe("small helpers", () => {
  it("mimeOf knows the image types and falls back to octet-stream", () => {
    expect(mimeOf("a.JPG")).toBe("image/jpeg");
    expect(mimeOf("a.svg")).toBe("image/svg+xml");
    expect(mimeOf("noext")).toBe("application/octet-stream");
    expect(mimeOf("a.tiff")).toBe("application/octet-stream");
  });

  it("reviewOfLabels uses the default prefix when the project's has a space", () => {
    expect(reviewOfLabels(["testimus-validated"], "my prefix")).toBe("validated");
    expect(reviewOfLabels(["x"], "")).toBeUndefined();
  });
});

const img = (file: string, remoteId?: string): StepImage => (remoteId ? { file, remoteId } : { file });
const step = (p: {
  id?: string;
  action?: string;
  data?: string;
  result?: string;
  images?: StepImage[];
  extra?: Record<string, string>;
}): Step => ({
  ...(p.id ? { id: p.id } : {}),
  fields: { Action: p.action ?? "", Data: p.data ?? "", "Expected Result": p.result ?? "", ...(p.extra ?? {}) },
  sources: [],
  images: p.images ?? [],
});
const localTest = (t: Partial<Test>): Test => ({
  project: "P",
  preconditions: [],
  summary: "Summary",
  folder: "/F",
  labels: ["testimus-validated"],
  description: "",
  covers: [],
  review: "validated",
  steps: [],
  extra: {},
  ...t,
});
const FIELDS: XrayField[] = [
  { id: "action", name: "Action", type: "text", builtin: true },
  { id: "data", name: "Data", type: "text", builtin: true },
  { id: "result", name: "Expected Result", type: "text", builtin: true },
];
const deps = {
  project: { id: "1", key: "P", name: "P", testIssueTypeId: "2", testIssueTypeName: "Test" },
  accountId: "acc",
  readImage: async (file: string) => new TextEncoder().encode(file),
  fields: FIELDS,
  labelPrefix: "testimus-",
};
const remote = (steps: Step[], over: Partial<Test> = {}, pre: Precondition[] = []): PulledTest => ({
  issueId: "100",
  images: [],
  preconditions: pre,
  test: localTest({ key: "P-1", steps, preconditions: pre.map((p) => p.key), ...over }),
});
const runAll = async (ops: Array<{ run: () => Promise<void> }>) => {
  for (const op of ops) await op.run();
};

describe("planPush, warnings", () => {
  it("warns about a bad label prefix, a remote change, an empty summary and several unknown fields", async () => {
    const t = localTest({ summary: " ", steps: [step({ action: "a", extra: { X: "1", Y: "2" } })] });
    const plan = await planPush(t, "t1", null, { ...deps, labelPrefix: "a b", remoteChanged: true });
    expect(plan.remoteChanged).toBe(true);
    expect(plan.warnings).toEqual([
      expect.stringContaining('The label prefix "a b"'),
      "Changed in Jira since your last sync — pushing will overwrite.",
      "The summary is empty.",
      expect.stringMatching(/^"X", "Y" are not step fields of P/),
    ]);
  });
});

describe("planPush, new test", () => {
  it("refuses a step with unreadable markup", async () => {
    const t = localTest({ steps: [step({ action: "!xray-attachment://9!" })] });
    const plan = await planPush(t, "t1", null, deps);
    expect(plan.ops).toEqual([]);
    expect(plan.warnings[0]).toMatch(/^Step 1 carries Xray markup/);
  });

  it("skips a precondition that is not a key, and one that is not found; creates without folder or preconditions", async () => {
    graph = (q) =>
      q.includes("getPreconditions")
        ? { getPreconditions: { total: 0, results: [] } }
        : q.includes("createTest")
          ? { createTest: { test: { issueId: "9", jira: { key: "P-9" } } } }
          : {};
    const t = localTest({ folder: "", description: "desc", preconditions: ["not a key", "P-77"] });
    const plan = await planPush(t, "t1", null, deps);
    expect(plan.warnings).toContain('"not a key" is not an issue key — not attached as a precondition.');
    expect(plan.warnings).toContain("P-77 is not a precondition of this project — not attached.");
    expect(plan.ops.map((o) => o.label)).toEqual(["Create test in Jira (t1)"]);
    await runAll(plan.ops);
    const create = gqlCalls().find((c) => c.body.query.includes("createTest"))!;
    expect(create.body.variables.folder).toBeUndefined();
    expect(create.body.variables.preconditions).toBeUndefined();
    expect(create.body.variables.jira.description).toBe("desc");
    expect(t.key).toBe("P-9");
  });

  it("asks nothing when every precondition key is malformed", async () => {
    const t = localTest({ preconditions: ["bad"] });
    await planPush(t, "t1", null, deps);
    expect(gqlCalls()).toHaveLength(0);
  });

  it("names the plural with two preconditions and embeds two images in one step", async () => {
    graph = (q) =>
      q.includes("getPreconditions")
        ? {
            getPreconditions: {
              total: 2,
              results: [
                { issueId: 1, jira: { key: "P-2" } },
                { issueId: 2, jira: { key: "P-3" } },
              ],
            },
          }
        : {};
    const images = [img("images/a.png"), img("images/b.png")];
    const t = localTest({
      preconditions: ["P-2", "P-3"],
      steps: [step({ action: "![](images/a.png) ![](images/b.png)", images })],
    });
    const plan = await planPush(t, "t1", null, deps);
    expect(plan.ops.map((o) => o.label)).toEqual([
      "Create test in Jira (t1) with 2 preconditions",
      "Embed 2 images in step 1",
    ]);
  });

  it("an embed fails when the step Jira answers has no id", async () => {
    const t = localTest({
      key: "P-1",
      steps: [step({ id: "s1", action: "![](images/a.png)", images: [img("images/a.png")] })],
    });
    graph = (q) => (q.includes("getTests") ? { getTests: { results: [{ steps: [{ data: "x" }] }] } } : {});
    const plan = await planPush(t, "t1", remote([step({ id: "s1" })]), deps);
    const embed = plan.ops.find((o) => o.kind === "embed")!;
    await expect(embed.run()).rejects.toThrow("Step 1 is not in Jira");
  });

  it("an embed reads a step without attachments", async () => {
    const t = localTest({
      key: "P-1",
      steps: [step({ id: "s1", action: "![](images/a.png)", images: [img("images/a.png")] })],
    });
    graph = (q) => (q.includes("getTests") ? { getTests: { results: [{ steps: [{ id: "s1" }] }] } } : {});
    const plan = await planPush(t, "t1", remote([step({ id: "s1" })]), deps);
    await plan.ops.find((o) => o.kind === "embed")!.run();
    expect(gqlCalls().at(-1)?.body.variables.step.action).toBe("​");
  });

  it("an embed of a test with no step answer fails too", async () => {
    const t = localTest({
      key: "P-1",
      steps: [step({ id: "s1", action: "![](images/a.png)", images: [img("images/a.png")] })],
    });
    graph = (q) => (q.includes("getTests") ? { getTests: {} } : {});
    const plan = await planPush(t, "t1", remote([step({ id: "s1" })]), deps);
    await expect(plan.ops.find((o) => o.kind === "embed")!.run()).rejects.toThrow("not in Jira");
  });
});

describe("planPush, existing test", () => {
  it("updates the description alone, keeps clonedFrom, and warns about a link it never removes", async () => {
    const r = remote([], { covers: ["P-5"], clonedFrom: "P-0", description: "old" });
    const t = localTest({ key: "P-1", description: "new", clonedFrom: "P-0", covers: [] });
    const plan = await planPush(t, "t1", r, deps);
    expect(plan.ops.map((o) => [o.label, o.kind])).toEqual([["Update description", "update"]]);
    expect(plan.warnings).toEqual(["Jira still links Test to P-5; links are never removed."]);
    await runAll(plan.ops);
    expect(calls.at(-1)?.body.fields.description.type).toBe("doc");
  });

  it("keeps the folder when the local one is empty", async () => {
    const plan = await planPush(localTest({ key: "P-1", folder: "" }), "t1", remote([], { folder: "/Other" }), deps);
    expect(plan.ops).toEqual([]);
  });

  it("passes on the warning Xray gives when attaching, and detaches one", async () => {
    graph = (q) =>
      q.includes("getPreconditions")
        ? { getPreconditions: { total: 1, results: [{ issueId: 5, jira: { key: "P-5" } }] } }
        : q.includes("addPreconditionsToTest")
          ? { addPreconditionsToTest: { warning: "already there" } }
          : {};
    const pre = [{ key: "P-6", issueId: "6", summary: "", definition: "" }];
    const plan = await planPush(localTest({ key: "P-1", preconditions: ["P-5"] }), "t1", remote([], {}, pre), deps);
    expect(plan.ops.map((o) => o.label)).toEqual(["Attach precondition P-5", "Detach precondition P-6"]);
    await runAll(plan.ops);
    expect(plan.warnings).toContain("already there");
  });

  it("an attach answer without warning adds none, and nothing is attached when nothing is found", async () => {
    graph = (q) =>
      q.includes("getPreconditions")
        ? { getPreconditions: { total: 1, results: [{ issueId: 5, jira: { key: "P-5" } }] } }
        : { addPreconditionsToTest: null };
    const plan = await planPush(localTest({ key: "P-1", preconditions: ["P-5"] }), "t1", remote([]), deps);
    await runAll(plan.ops);
    expect(plan.warnings).toEqual([]);
    graph = () => ({ getPreconditions: { total: 0, results: [] } });
    const none = await planPush(localTest({ key: "P-1", preconditions: ["P-8"] }), "t1", remote([]), deps);
    expect(none.ops).toEqual([]);
  });

  it("does not rebuild reordered steps when one carries unreadable markup", async () => {
    const r = remote([step({ id: "s1" }), step({ id: "s2" })]);
    const t = localTest({
      key: "P-1",
      steps: [step({ id: "s2", action: "!xray-attachment://9!" }), step({ id: "s1" })],
    });
    const plan = await planPush(t, "t1", r, deps);
    expect(plan.ops).toEqual([]);
    expect(plan.warnings[0]).toMatch(/the steps were reordered — no step is touched/);
  });

  it("a rebuild embeds the images of the steps that show them", async () => {
    const r = remote([step({ id: "s1" }), step({ id: "s2" })]);
    const t = localTest({
      key: "P-1",
      steps: [step({ id: "s2", action: "![](images/a.png)", images: [img("images/a.png")] }), step({ id: "s1" })],
    });
    const plan = await planPush(t, "t1", r, deps);
    expect(plan.ops.map((o) => o.label)).toEqual([
      "Remove all 2 remote steps",
      "Add step 1",
      "Add step 2",
      "Embed 1 image in step 1",
    ]);
    await runAll(plan.ops.slice(0, 3));
    expect(gqlCalls().map((c) => Object.keys(c.body.variables).sort().join())).toEqual([
      "issueId",
      "issueId,step",
      "issueId,step",
    ]);
  });

  it("removes a remote step, and adds a new step with an image to embed", async () => {
    const r = remote([step({ id: "s1", action: "a" }), step({ id: "s2", action: "b" })]);
    const t = localTest({
      key: "P-1",
      steps: [step({ id: "s1", action: "a" }), step({ action: "![](images/n.png)", images: [img("images/n.png")] })],
    });
    const plan = await planPush(t, "t1", r, deps);
    expect(plan.ops.map((o) => o.label)).toEqual(["Remove step 2", "Add step 2", "Embed 1 image in step 2"]);
    await runAll(plan.ops.slice(0, 2));
    expect(gqlCalls()[0].body.variables).toEqual({ stepId: "s2" });
    expect(gqlCalls()[1].body.variables.step.attachments[0].filename).toBe("n.png");
  });

  it("re-uploads every image when the kept ones changed order, and removes images", async () => {
    const r = remote([step({ id: "s1", action: "a", images: [img("images/x.png", "rx"), img("images/y.png", "ry")] })]);
    const t = localTest({
      key: "P-1",
      steps: [step({ id: "s1", action: "a", images: [img("images/y.png", "ry"), img("images/x.png", "rx")] })],
    });
    const plan = await planPush(t, "t1", r, deps);
    expect(plan.ops.map((o) => [o.label, o.kind])).toEqual([
      ["Upload 2 images to step 1 + Remove 2 images from step 1", "upload"],
    ]);
    await runAll(plan.ops);
    const s = gqlCalls()[0].body.variables.step;
    expect(s.attachments.add.map((a: any) => a.filename)).toEqual(["y.png", "x.png"]);
    expect(s.attachments.removeIds).toEqual(["rx", "ry"]);
  });

  it("removes one image only, and re-uploads all when a new image is inserted before a known one", async () => {
    const r = remote([step({ id: "s1", action: "a", images: [img("images/x.png", "rx")] })]);
    const removed = await planPush(localTest({ key: "P-1", steps: [step({ id: "s1", action: "a" })] }), "t1", r, deps);
    expect(removed.ops.map((o) => [o.label, o.kind])).toEqual([["Remove 1 image from step 1", "update"]]);
    await runAll(removed.ops);
    expect(gqlCalls()[0].body.variables.step).toEqual({ attachments: { removeIds: ["rx"] } });

    const inserted = await planPush(
      localTest({
        key: "P-1",
        steps: [step({ id: "s1", action: "a", images: [img("images/n.png"), img("images/x.png", "rx")] })],
      }),
      "t1",
      r,
      deps,
    );
    expect(inserted.ops[0].label).toBe("Upload 2 images to step 1 + Remove 1 image from step 1");
  });

  it("updates data and result text, with a blank action kept blank", async () => {
    const r = remote([step({ id: "s1", action: "a", data: "d", result: "r" })]);
    const t = localTest({ key: "P-1", steps: [step({ id: "s1", action: "", data: "d2", result: "r2" })] });
    const plan = await planPush(t, "t1", r, deps);
    await runAll(plan.ops);
    expect(gqlCalls()[0].body.variables.step).toEqual({ action: "​", data: "d2", result: "r2" });
  });
});

describe("planPush, remaining corners", () => {
  it("an embed run twice fetches the steps once, and keeps the params of a known attachment", async () => {
    graph = (q) =>
      q.includes("getTests")
        ? { getTests: { results: [{ steps: [{ id: "s1", attachments: [{ id: "n1", filename: "a.png" }] }] }] } }
        : {};
    const t = localTest({
      key: "P-1",
      steps: [step({ id: "s1", action: '![](images/a.png "width=5")', images: [img("images/a.png")] })],
    });
    const plan = await planPush(t, "t1", remote([step({ id: "s1" })]), deps);
    const embed = plan.ops.find((o) => o.kind === "embed")!;
    await embed.run();
    await embed.run();
    expect(gqlCalls().filter((c) => c.body.query.includes("getTests"))).toHaveLength(1);
    expect(gqlCalls().at(-1)?.body.variables.step.action).toBe("!xray-attachment://n1|width=5!");
  });

  it("compares a remote step without id or image ids, and an image ref the step does not know", async () => {
    const r = remote([
      { ...step({ action: "a ![](images/r.png)", images: [img("images/r.png")] }) },
      step({ id: "s2", action: "b" }),
    ]);
    const t = localTest({
      key: "P-1",
      steps: [
        step({ action: "a" }),
        step({ id: "s2", action: "b ![](images/z.png)", images: [img("images/z.png", "rz")] }),
      ],
    });
    const plan = await planPush(t, "t1", r, deps);
    expect(plan.ops.map((o) => o.label)).toEqual(expect.arrayContaining([expect.stringMatching(/step/)]));
  });
});

describe("pullTest, nameless pieces", () => {
  it("names a nameless attachment image.png and reads a precondition without Jira fields", async () => {
    graph = () => ({
      getTests: {
        results: [
          {
            issueId: 1,
            steps: [{ id: "s", attachments: [{ id: "a1", filename: "" }] }],
            preconditions: { results: [{ issueId: 4, definition: "def" }, { issueId: 3 }] },
          },
        ],
      },
    });
    route = (req) => (req.url.includes("/issue/") ? ok({ fields: {} }) : undefined);
    const p = await pullTest("P-1");
    expect(p.images[0].filename).toBe("image.png");
    expect(p.preconditions).toEqual([
      { key: "", issueId: "4", summary: "", definition: "def" },
      { key: "", issueId: "3", summary: "", definition: "" },
    ]);
  });

  it("uploads an image whose path ends with a separator under its whole path", async () => {
    const t = localTest({ steps: [step({ action: "a", images: [img("images/")] })] });
    graph = (q) => (q.includes("createTest") ? { createTest: { test: { issueId: "9", jira: { key: "P-9" } } } } : {});
    const plan = await planPush(t, "t1", null, deps);
    await runAll(plan.ops);
    expect(gqlCalls()[0].body.variables.steps[0].attachments[0].filename).toBe("images/");
  });
});
