import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, test } from "vitest";
import { env, type HttpReq, type HttpRes } from "../../src/core/env.ts";
import {
  browseUrl,
  bulkTestJson,
  decideStepSync,
  getFolderTree,
  getMyself,
  getProjectInfo,
  getStepFields,
  listTests,
  type PulledTest,
  planPush,
  pullTest,
  resetAuth,
  retryAfter,
  reviewLabels,
  searchTests,
} from "../../src/core/lib/jira.ts";
import { hasRawEmbed } from "../../src/core/lib/testfile.ts";
import type { Precondition, Review, Step, StepImage, Test, XrayField } from "../../src/core/types.ts";

type Call = { method: string; url: string; headers: Record<string, string>; body: any };

const JIRA = "https://t.atlassian.net";
const XRAY = "https://xray.cloud.getxray.app";

let calls: Call[] = [];
let rest: (req: HttpReq) => unknown = () => ({});
let graph: (query: string, vars: any) => unknown = () => ({});
let gqlStatus: number[] = [];

const json = (body: unknown, status = 200): HttpRes => ({ status, headers: {}, text: JSON.stringify(body) });
const gql = (n = 0) => calls.filter((c) => c.url.endsWith("/graphql"))[n];
const restCalls = () => calls.filter((c) => c.url.startsWith(JIRA));
const b64 = (s: string) => Buffer.from(s).toString("base64");

const http = env.http;
afterAll(() => {
  env.http = http;
});

beforeEach(() => {
  calls = [];
  gqlStatus = [];
  rest = () => ({});
  graph = () => ({});
  resetAuth();
  const dir = join(env.homeDir(), ".atlassian");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "credentials.json"),
    `﻿${JSON.stringify({ baseUrl: `${JIRA}/wiki`, email: "me@x.com", token: "tok" })}`,
  );
  writeFileSync(join(dir, "xray_credentials.json"), JSON.stringify({ clientId: "cid", clientSecret: "sec" }));
  env.http = async (req: HttpReq): Promise<HttpRes> => {
    calls.push({
      method: req.method,
      url: req.url,
      headers: req.headers ?? {},
      body: req.body ? JSON.parse(req.body) : undefined,
    });
    if (req.url.includes("/api/v2/authenticate")) return { status: 200, headers: {}, text: JSON.stringify("jwt-1") };
    if (req.url.endsWith("/graphql")) {
      const status = gqlStatus.shift() ?? 200;
      if (status !== 200) return { status, headers: {}, text: "nope" };
      const body = JSON.parse(req.body ?? "{}");
      return json({ data: graph(body.query, body.variables) });
    }
    if (req.binary) return { status: 200, headers: {}, bytes: new TextEncoder().encode("PNGDATA") };
    return json(rest(req));
  };
});

describe("credentials", () => {
  it("builds the browse url from the tenant, without the /wiki suffix", () => {
    expect(browseUrl("BHPTCC-2234")).toBe(`${JIRA}/browse/BHPTCC-2234`);
  });
});

describe("read paths", () => {
  it("getProjectInfo picks the Xray Test issue type and uses Basic auth", async () => {
    rest = () => ({
      id: 11987,
      key: "BHPTCC",
      name: "BHP TCC",
      issueTypes: [
        { id: "10001", name: "Task" },
        { id: "10935", name: "Xray Test" },
      ],
    });
    expect(await getProjectInfo("BHPTCC")).toEqual({
      id: "11987",
      key: "BHPTCC",
      name: "BHP TCC",
      testIssueTypeId: "10935",
      testIssueTypeName: "Xray Test",
    });
    expect(calls[0].url).toBe(`${JIRA}/rest/api/3/project/BHPTCC`);
    expect(calls[0].headers.Authorization).toBe(`Basic ${b64("me@x.com:tok")}`);
  });

  it("getProjectInfo turns a 404 into a human message", async () => {
    env.http = async () => ({ status: 404, headers: {}, text: "{}" });
    await expect(getProjectInfo("NOPE")).rejects.toThrow("Jira 404 — project NOPE not found");
  });

  it("a 401 names the credentials file to fix", async () => {
    env.http = async () => ({ status: 401, headers: {}, text: "{}" });
    await expect(getProjectInfo("X")).rejects.toThrow("Jira 401 — check ~/.atlassian/credentials.json");
  });

  it("getFolderTree maps the nested JSON folders and totals the subtree", async () => {
    graph = () => ({
      getFolder: {
        name: "Test Repository",
        path: "/",
        testsCount: 39,
        folders: [
          { name: "Release 7.4", path: "/Release 7.4", testsCount: 2, folders: [] },
          {
            name: "Archive",
            path: "/Archive",
            testsCount: 0,
            folders: [
              { name: "2024", path: "/Archive/2024", testsCount: 7, folders: [] },
              {
                name: "2025",
                path: "/Archive/2025",
                testsCount: 4,
                folders: [{ name: "Q1", path: "/Archive/2025/Q1", testsCount: 1, folders: [] }],
              },
            ],
          },
        ],
      },
    });
    const root = await getFolderTree("11987");
    expect([root.testsCount, root.totalCount]).toEqual([39, 53]);
    expect(root.folders.map((f) => [f.path, f.testsCount, f.totalCount])).toEqual([
      ["/Release 7.4", 2, 2],
      ["/Archive", 0, 12],
    ]);
    expect(gql().body.variables).toEqual({ projectId: "11987", path: "/" });
  });

  it("listTests pages a folder query", async () => {
    graph = () => ({
      getTests: {
        total: 130,
        results: [
          {
            issueId: "1300982",
            folder: { path: "/Release 7.4" },
            jira: { key: "BHPTCC-1", summary: "s", status: { name: "To Do" }, labels: ["bhp"] },
            steps: [{ id: "a" }, { id: "b" }],
          },
        ],
      },
    });
    const out = await listTests("11987", { folder: "/Release 7.4", descendants: true }, 1);
    expect(out.total).toBe(130);
    expect(out.tests[0]).toEqual({
      key: "BHPTCC-1",
      issueId: "1300982",
      summary: "s",
      status: "To Do",
      labels: ["bhp"],
      folder: "/Release 7.4",
      stepCount: 2,
    });
    expect(gql().body.variables).toEqual({
      jql: null,
      projectId: "11987",
      folder: { path: "/Release 7.4", includeDescendants: true },
      limit: 100,
      start: 100,
    });
  });

  it("searchTests builds an escaped jql and drops the project scope", async () => {
    graph = () => ({ getTests: { total: 0, results: [] } });
    await searchTests("11987", 'TSR "manage"');
    expect(gql().body.variables).toEqual({
      jql: 'project = 11987 AND issuetype in ("Xray Test","Test") AND summary ~ "TSR \\"manage\\""',
      projectId: null,
      folder: null,
      limit: 100,
      start: 0,
    });
  });

  it("searchTests asks the three questions an issue key raises, and reads bare digits as a key", async () => {
    graph = () => ({ getTests: { total: 0, results: [] } });
    await searchTests("11987", "  BHPM-250 ");
    expect(gql().body.variables.jql).toBe(
      'project = 11987 AND issuetype in ("Xray Test","Test") AND ' +
        '(key = BHPM-250 OR summary ~ "BHPM-250" OR issue in linkedIssues("BHPM-250"))',
    );
    calls = [];
    await searchTests("11987", " 250 ", "BHPM");
    expect(gql().body.variables.jql).toBe(
      'project = 11987 AND issuetype in ("Xray Test","Test") AND ' +
        '(key = BHPM-250 OR summary ~ "250" OR issue in linkedIssues("BHPM-250"))',
    );
    calls = [];
    await searchTests("11987", "BHPM-250 manage");
    expect(gql().body.variables.jql).toBe(
      'project = 11987 AND issuetype in ("Xray Test","Test") AND summary ~ "BHPM-250 manage"',
    );
  });

  it("re-authenticates once on a 401 from GraphQL", async () => {
    gqlStatus = [401];
    graph = () => ({ getFolder: { name: "/", path: "/", testsCount: 0, folders: [] } });
    await getFolderTree("11987");
    expect(calls.map((c) => c.url)).toEqual([
      `${XRAY}/api/v2/authenticate`,
      `${XRAY}/api/v2/graphql`,
      `${XRAY}/api/v2/authenticate`,
      `${XRAY}/api/v2/graphql`,
    ]);
  });

  it("getMyself returns the account id", async () => {
    rest = () => ({ accountId: "acc-1", displayName: "Me", emailAddress: "me@x.com" });
    expect(await getMyself()).toEqual({ accountId: "acc-1", displayName: "Me", emailAddress: "me@x.com" });
    expect(calls[0].url).toBe(`${JIRA}/rest/api/3/myself`);
  });

  it("getStepFields maps the built-in three to their test.md names, keeps custom ids and the required / off flags", async () => {
    graph = () => ({
      getProjectSettings: {
        testStepSettings: {
          fields: [
            { id: "693943bde99dd800f1887075", name: "action", type: "text" },
            { id: "693943bde99dd800f1887076", name: "data", type: "text" },
            { id: "693943bde99dd800f1887077", name: "result", type: "text" },
            { id: "69d5fcb02f2b49abf7fb76e6", name: "Exigence", type: "text-single", required: true },
            { id: "old", name: "Retired", type: "text", disabled: true },
          ],
        },
      },
    });
    expect(await getStepFields("12445")).toEqual([
      { id: "693943bde99dd800f1887075", name: "Action", type: "text", builtin: true },
      { id: "693943bde99dd800f1887076", name: "Data", type: "text", builtin: true },
      { id: "693943bde99dd800f1887077", name: "Expected Result", type: "text", builtin: true },
      { id: "69d5fcb02f2b49abf7fb76e6", name: "Exigence", type: "text-single", builtin: false, required: true },
      { id: "old", name: "Retired", type: "text", builtin: false, disabled: true },
    ]);
    expect(gql().body.variables).toEqual({ projectIdOrKey: "12445" });
    expect(gql().body.query).toContain("testStepSettings");
  });
});

describe("pullTest", () => {
  beforeEach(() => {
    graph = () => ({
      getTests: {
        results: [
          {
            issueId: "1300982",
            folder: { path: "/Release 8.0" },
            jira: { key: "BHPTCC-2234" },
            steps: [
              {
                id: "s1",
                action: "Log in  \n\n\n!xray-attachment://att-1|width=10,height=10!",
                data: null,
                result: "ok",
                customFields: [{ id: "cf-exi", name: "Exigence", value: "EXI_1, EXI_2" }],
              },
              {
                id: "s2",
                action: "second !xray-attachment://att-1|width=10,height=10!",
                data: "",
                result: "and this !xray-attachment://att-3!",
                attachments: [
                  { id: "att-3", filename: "c.png", downloadLink: `${JIRA}/rest/api/3/attachment/content/att-3` },
                  {
                    id: "att-1",
                    filename: "shot one.png",
                    downloadLink: `${JIRA}/rest/api/3/attachment/content/att-1`,
                  },
                  {
                    id: "att-2",
                    filename: "b.png",
                    downloadLink: "https://us.xray.cloud.getxray.app/api/v2/attachments/att-2",
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    rest = () => ({
      id: "1300982",
      key: "BHPTCC-2234",
      fields: {
        summary: "R8-2506-MWS-TSR-Manage",
        labels: ["bhp", "test"],
        status: { name: "To Do" },
        description: {
          type: "doc",
          version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: "Test steps" }] }],
        },
        issuelinks: [
          { type: { name: "Cloners" }, outwardIssue: { key: "BHPTCC-2083" } },
          { type: { name: "Test" }, outwardIssue: { key: "BHPTCC-2174" } },
          { type: { name: "Test" }, inwardIssue: { key: "BHPTCC-9999" } },
        ],
      },
    });
  });

  it("maps steps and custom fields, turns markers into refs and reads the links", async () => {
    const p = await pullTest("BHPTCC-2234");
    expect(p.issueId).toBe("1300982");
    expect(p.test).toMatchObject({
      key: "BHPTCC-2234",
      project: "BHPTCC",
      summary: "R8-2506-MWS-TSR-Manage",
      folder: "/Release 8.0",
      labels: ["bhp", "test"],
      status: "To Do",
      description: "Test steps",
      covers: ["BHPTCC-2174"],
      clonedFrom: "BHPTCC-2083",
      review: "draft",
    });
    expect(p.test.steps[0]).toEqual({
      id: "s1",
      fields: {
        Action: "Log in  \n\n\n!xray-attachment://att-1|width=10,height=10!",
        Data: "",
        "Expected Result": "ok",
        Exigence: "EXI_1, EXI_2",
      },
      sources: [],
      images: [],
    });
    expect(hasRawEmbed(p.test.steps[0])).toBe(true);
    expect(p.test.steps[1].fields).toMatchObject({
      Action: 'second ![](images/att-1-shot_one.png "width=10,height=10")',
      "Expected Result": "and this ![](images/att-3-c.png)",
    });
    expect(hasRawEmbed(p.test.steps[1])).toBe(false);
    expect(p.test.steps[1].images).toEqual([
      { file: "images/att-3-c.png", remoteId: "att-3" },
      { file: "images/att-1-shot_one.png", remoteId: "att-1" },
      { file: "images/att-2-b.png", remoteId: "att-2" },
    ]);
    expect(gql().body.query).toContain("customFields { id name value }");
    expect(restCalls()[0].url).toBe(
      `${JIRA}/rest/api/3/issue/BHPTCC-2234?fields=summary,labels,status,description,issuelinks`,
    );
  });

  it("downloads with Basic auth on the Jira host and Bearer on the Xray host", async () => {
    const p = await pullTest("BHPTCC-2234");
    expect(new TextDecoder().decode(await p.images[0].download())).toBe("PNGDATA");
    await p.images[2].download();
    const dl = calls.filter((c) => c.url.includes("attachment"));
    expect(dl[0].headers.Authorization).toBe(`Basic ${b64("me@x.com:tok")}`);
    expect(dl[1].headers.Authorization).toBe("Bearer jwt-1");
    expect(dl[1].headers.Accept).toBeUndefined();
  });
});

describe("decideStepSync", () => {
  it("keeps in place when local ids are an ordered subsequence and new steps are last", () => {
    expect(decideStepSync(["a", "c", undefined], ["a", "b", "c"])).toEqual({
      mode: "in-place",
      remove: ["b"],
      update: [0, 1],
      add: [2],
    });
  });

  it("handles the empty cases", () => {
    expect(decideStepSync([], ["a"])).toEqual({ mode: "in-place", remove: ["a"], update: [], add: [] });
    expect(decideStepSync([undefined, undefined], [])).toEqual({
      mode: "in-place",
      remove: [],
      update: [],
      add: [0, 1],
    });
  });

  it("rebuilds on reorder, on an unknown id, and on an inserted step", () => {
    expect(decideStepSync(["b", "a"], ["a", "b"])).toEqual({ mode: "rebuild" });
    expect(decideStepSync(["a", "zz"], ["a", "b"])).toEqual({ mode: "rebuild" });
    expect(decideStepSync([undefined, "a"], ["a"])).toEqual({ mode: "rebuild" });
    expect(decideStepSync(["a", "a"], ["a", "b"])).toEqual({ mode: "rebuild" });
  });
});

const img = (file: string, remoteId?: string): StepImage => (remoteId ? { file, remoteId } : { file });

type StepParts = {
  id?: string;
  action?: string;
  data?: string;
  result?: string;
  exigence?: string;
  images?: StepImage[];
  sources?: Step["sources"];
};
const step = (s: StepParts): Step => ({
  ...(s.id ? { id: s.id } : {}),
  fields: {
    Action: s.action ?? "",
    Data: s.data ?? "",
    "Expected Result": s.result ?? "",
    ...(s.exigence !== undefined ? { Exigence: s.exigence } : {}),
  },
  sources: s.sources ?? [],
  images: s.images ?? [],
});

const localTest = (t: Partial<Test>): Test => ({
  project: "BHPTCC",
  preconditions: [],
  summary: "Summary",
  folder: "/Release 8.0",
  labels: ["bhp", "testimus-validated"],
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
  { id: "cf-exigence", name: "Exigence", type: "text-single", builtin: false },
];

const deps = {
  project: { id: "11987", key: "BHPTCC", name: "BHP", testIssueTypeId: "10935", testIssueTypeName: "Xray Test" },
  accountId: "acc-1",
  readImage: async (file: string) => new TextEncoder().encode(`bytes:${file}`),
  fields: FIELDS,
  labelPrefix: "testimus-",
};

const ZWSP = "​";
const b64of = (file: string) => b64(`bytes:${file}`);

const runAll = async (ops: Array<{ run: () => Promise<void> }>) => {
  for (const op of ops) await op.run();
};

const remotePulled = (steps: Step[], over: Partial<Test> = {}, preconditions: Precondition[] = []): PulledTest => ({
  issueId: "1300982",
  images: [],
  preconditions,
  test: localTest({
    key: "BHPTCC-2234",
    summary: "Summary",
    steps,
    preconditions: preconditions.map((p) => p.key),
    ...over,
  }),
});

describe("planPush — the created issue's own fields", () => {
  it("leaves out the description when empty, and always sends the review label", async () => {
    graph = () => ({ createTest: { test: { issueId: "9", jira: { key: "BHPTCC-9" } } } });
    const local = localTest({ labels: [], description: "", steps: [step({ action: "do" })] });
    await runAll((await planPush(local, "local-1", null, deps)).ops);
    expect(gql(0).body.variables.jira).toEqual({
      project: { key: "BHPTCC" },
      issuetype: { id: "10935" },
      summary: "Summary",
      assignee: { id: "acc-1" },
      labels: ["testimus-validated"],
    });
  });
});

describe("planPush — a step Xray would refuse", () => {
  it("sends a zero-width space as the action of a step that has none, on create and on update", async () => {
    graph = () => ({ createTest: { test: { issueId: "9", jira: { key: "BHPTCC-9" } } } });
    const created = localTest({ steps: [step({ result: "only expected" }), step({ data: "only data" })] });
    await runAll((await planPush(created, "local-1", null, deps)).ops);
    expect(gql(0).body.variables.steps).toEqual([
      { action: ZWSP, data: "", result: "only expected", attachments: [] },
      { action: ZWSP, data: "only data", result: "", attachments: [] },
    ]);

    calls = [];
    graph = () => ({});
    const remote = remotePulled([step({ id: "s1", action: "do", result: "ok" })]);
    const cleared = localTest({ key: "BHPTCC-2234", steps: [step({ id: "s1", action: "", result: "ok" })] });
    const second = await planPush(cleared, "BHPTCC-2234", remote, deps);
    expect(second.ops.map((o) => o.label)).toEqual(["Update step 1"]);
    await runAll(second.ops);
    expect(gql(0).body.variables.step).toEqual({ action: ZWSP });
  });

  it("strips it again on the way back, so the local file keeps an empty action", async () => {
    graph = () => ({
      getTests: { results: [{ issueId: "1", jira: { key: "BHPTCC-9" }, steps: [{ id: "s1", action: ZWSP }] }] },
    });
    rest = () => ({ fields: { summary: "s", labels: [] } });
    const pulled = await pullTest("BHPTCC-9");
    expect(pulled.test.steps[0].fields.Action).toBe("");
  });

  it("creates a step whose action is only a screenshot with the ref, then embeds the marker", async () => {
    graph = (q) =>
      q.includes("getTests")
        ? { getTests: { results: [{ steps: [{ id: "s1", attachments: [{ id: "new-1", filename: "img-1.png" }] }] }] } }
        : { createTest: { test: { issueId: "9", jira: { key: "BHPTCC-9" } } } };
    const local = localTest({
      steps: [step({ action: "![](images/img-1.png)", images: [img("images/img-1.png")] })],
    });
    const plan = await planPush(local, "local-1", null, deps);
    expect(plan.ops.map((o) => [o.label, o.kind])).toEqual([
      ["Create test in Jira (local-1)", "create"],
      ["Embed 1 image in step 1", "embed"],
    ]);
    await runAll(plan.ops);
    expect(gql(0).body.variables.steps[0].action).toBe("![](images/img-1.png)");
    expect(gql(2).body.variables.step.action).toBe("!xray-attachment://new-1!");
  });
});

describe("planPush — new test", () => {
  it("creates the test with every step field, then links Cloners and Test", async () => {
    graph = () => ({ createTest: { test: { issueId: "999", jira: { key: "BHPTCC-3000" } }, warnings: ["late"] } });
    rest = () => ({ id: "40001" });
    const local = localTest({
      summary: "New test",
      description: "Test steps are based on the following item/s:",
      covers: ["BHPTCC-2174", "BHPTCC-2175"],
      clonedFrom: "BHPTCC-2083",
      steps: [
        step({
          action: "do",
          result: "ok",
          exigence: "EXI_MOP_SPF_511_A_1650",
          images: [img("images/img-1.png")],
          sources: [{ docId: "SOSIE_211_D401-1_3", anchor: "§5.6.6", quote: "Selon le type" }],
        }),
      ],
    });
    const plan = await planPush(local, "local-1a2b3c4d", null, deps);
    expect(plan.ops.map((o) => o.label)).toEqual([
      "Create test in Jira (local-1a2b3c4d)",
      "Link Cloners to BHPTCC-2083",
      "Link Test to BHPTCC-2174",
      "Link Test to BHPTCC-2175",
    ]);

    await runAll(plan.ops);
    expect(local.key).toBe("BHPTCC-3000");
    expect(plan.warnings).toContain("late");
    expect(gql().body.variables).toEqual({
      jira: {
        project: { key: "BHPTCC" },
        issuetype: { id: "10935" },
        summary: "New test",
        assignee: { id: "acc-1" },
        labels: ["bhp", "testimus-validated"],
        description: "Test steps are based on the following item/s:",
      },
      steps: [
        {
          action: "do",
          data: "",
          result: "ok",
          attachments: [{ filename: "img-1.png", mimeType: "image/png", data: b64of("images/img-1.png") }],
          customFields: [{ id: "cf-exigence", value: "EXI_MOP_SPF_511_A_1650" }],
        },
      ],
      folder: "/Release 8.0",
    });
    expect(JSON.stringify(calls)).not.toContain("Selon le type");
    expect(restCalls().map((c) => [c.method, c.url, c.body])).toEqual([
      [
        "POST",
        `${JIRA}/rest/api/3/issueLink`,
        { type: { name: "Cloners" }, inwardIssue: { key: "BHPTCC-3000" }, outwardIssue: { key: "BHPTCC-2083" } },
      ],
      [
        "POST",
        `${JIRA}/rest/api/3/issueLink`,
        { type: { name: "Test" }, inwardIssue: { key: "BHPTCC-3000" }, outwardIssue: { key: "BHPTCC-2174" } },
      ],
      [
        "POST",
        `${JIRA}/rest/api/3/issueLink`,
        { type: { name: "Test" }, inwardIssue: { key: "BHPTCC-3000" }, outwardIssue: { key: "BHPTCC-2175" } },
      ],
    ]);
  });
});

describe("planPush — review label", () => {
  it("replaces the old review label with the new one and warns the test is not validated", async () => {
    rest = () => ({});
    const remote = remotePulled([step({ id: "s1", action: "do" })], {
      labels: ["bhp", "testimus-draft", "testimus-batch-3"],
    });
    const local = localTest({
      key: "BHPTCC-2234",
      review: "checked",
      labels: ["bhp", "testimus-draft", "testimus-batch-3"],
      steps: [step({ id: "s1", action: "do" })],
    });
    const plan = await planPush(local, "BHPTCC-2234", remote, deps);
    expect(plan.ops.map((o) => [o.label, o.kind])).toEqual([
      ["Update labels (review label testimus-checked)", "label"],
    ]);
    expect(plan.warnings).toEqual([
      "This test is not validated (review: checked) — it goes to Jira labelled testimus-checked.",
    ]);
    await runAll(plan.ops);
    expect(restCalls()[0].body).toEqual({ fields: { labels: ["bhp", "testimus-batch-3", "testimus-checked"] } });
  });

  it("honours the project's label prefix", () => {
    const all: Review[] = ["draft", "checked", "to-fix", "validated"];
    for (const r of all) expect(reviewLabels(["qa-draft", "x"], r, "qa-")).toEqual(["x", `qa-${r}`]);
  });

  it("plans nothing when the label already says the review state", async () => {
    const remote = remotePulled([step({ id: "s1", action: "do" })]);
    const local = localTest({ key: "BHPTCC-2234", steps: [step({ id: "s1", action: "do" })] });
    const plan = await planPush(local, "BHPTCC-2234", remote, deps);
    expect(plan.ops).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });
});

describe("planPush — custom step fields", () => {
  it("updates only the custom field that changed, with its id", async () => {
    graph = () => ({});
    const remote = remotePulled([
      step({ id: "s1", action: "do", exigence: "EXI_1" }),
      step({ id: "s2", action: "two", exigence: "EXI_2" }),
    ]);
    const local = localTest({
      key: "BHPTCC-2234",
      steps: [step({ id: "s1", action: "do", exigence: "EXI_1, EXI_3" }), step({ id: "s2", action: "two" })],
    });
    const plan = await planPush(local, "BHPTCC-2234", remote, deps);
    expect(plan.ops.map((o) => o.label)).toEqual(["Update step 1", "Update step 2"]);
    await runAll(plan.ops);
    expect(gql(0).body.variables).toEqual({
      stepId: "s1",
      step: { customFields: [{ id: "cf-exigence", value: "EXI_1, EXI_3" }] },
    });
    expect(gql(1).body.variables).toEqual({ stepId: "s2", step: { customFields: [{ id: "cf-exigence", value: "" }] } });
  });

  it("sends custom fields with a built-in change in one update, and on an added step", async () => {
    graph = () => ({});
    const remote = remotePulled([step({ id: "s1", action: "do", result: "ok" })]);
    const local = localTest({
      key: "BHPTCC-2234",
      steps: [
        step({ id: "s1", action: "do", result: "fine", exigence: "EXI_1" }),
        step({ action: "new", exigence: "EXI_2" }),
      ],
    });
    const plan = await planPush(local, "BHPTCC-2234", remote, deps);
    await runAll(plan.ops);
    expect(gql(0).body.variables.step).toEqual({
      result: "fine",
      customFields: [{ id: "cf-exigence", value: "EXI_1" }],
    });
    expect(gql(1).body.variables).toEqual({
      issueId: "1300982",
      step: {
        action: "new",
        data: "",
        result: "",
        attachments: [],
        customFields: [{ id: "cf-exigence", value: "EXI_2" }],
      },
    });
  });

  it("warns about a field the project does not have, and never sends it", async () => {
    graph = () => ({ createTest: { test: { issueId: "9", jira: { key: "BHPTCC-9" } } } });
    const s = step({ action: "do" });
    s.fields.Priority = "high";
    s.fields.Severity = "  ";
    const plan = await planPush(localTest({ steps: [s] }), "local-1", null, deps);
    expect(plan.warnings).toEqual([
      '"Priority" is not a step field of BHPTCC — not pushed (refresh the fields with xray.fields if it was just added).',
    ]);
    await runAll(plan.ops);
    expect(JSON.stringify(gql(0).body)).not.toContain("high");
  });

  it("sends a non-text column back parsed, so a toggle or a multi-select stays what Xray holds", async () => {
    graph = () => ({ createTest: { test: { issueId: "9", jira: { key: "BHPTCC-9" } } } });
    const s = step({ action: "do" });
    s.fields.Done = "true";
    s.fields.Tags = '["a","b"]';
    s.fields.Exigence = "EXI_1";
    const plan = await planPush(localTest({ steps: [s] }), "local-1", null, {
      ...deps,
      fields: [
        ...deps.fields,
        { id: "cf-done", name: "Done", type: "toggle", builtin: false },
        { id: "cf-tags", name: "Tags", type: "multiselect", builtin: false },
      ],
    });
    await runAll(plan.ops);
    const custom = JSON.stringify(gql(0).body);
    expect(custom).toContain('{"id":"cf-done","value":true}');
    expect(custom).toContain('{"id":"cf-tags","value":["a","b"]}');
    expect(custom).toContain('{"id":"cf-exigence","value":"EXI_1"}');
  });

  it("warns when a field Xray requires is empty on a step, but not for a field switched off", async () => {
    graph = () => ({ createTest: { test: { issueId: "9", jira: { key: "BHPTCC-9" } } } });
    const filled = step({ action: "do" });
    filled.fields.Exigence = "EXI_1";
    const plan = await planPush(
      localTest({ steps: [filled, step({ action: "again" }), step({ action: "end" })] }),
      "local-1",
      null,
      {
        ...deps,
        fields: [
          ...deps.fields.map((f) => (f.name === "Exigence" ? { ...f, required: true } : f)),
          { id: "cf-old", name: "Retired", type: "text", builtin: false, required: true, disabled: true },
        ],
      },
    );
    expect(plan.warnings).toEqual(["Exigence is required in Xray and empty in step 2, 3."]);
  });

  it("a source change alone plans nothing — sources are local", async () => {
    const remote = remotePulled([step({ id: "s1", action: "do" })]);
    const local = localTest({
      key: "BHPTCC-2234",
      steps: [step({ id: "s1", action: "do", sources: [{ docId: "D", anchor: "§1", quote: "q" }] })],
    });
    expect((await planPush(local, "BHPTCC-2234", remote, deps)).ops).toEqual([]);
  });
});

describe("planPush — preconditions", () => {
  const pre = (key: string, issueId: string): Precondition => ({ key, issueId, summary: key, definition: "given" });
  const resolves = (...list: Precondition[]) => ({
    getPreconditions: { total: list.length, results: list.map((p) => ({ issueId: p.issueId, jira: { key: p.key } })) },
  });

  it("attaches them by issue id when the test is created", async () => {
    graph = (q) =>
      q.includes("getPreconditions")
        ? resolves(pre("BHPTCC-2077", "1246749"), pre("BHPTCC-2075", "1246747"))
        : { createTest: { test: { issueId: "9", jira: { key: "BHPTCC-9" } } } };
    const local = localTest({ preconditions: ["BHPTCC-2077", "BHPTCC-2075"], steps: [step({ action: "do" })] });
    const plan = await planPush(local, "local-1", null, deps);
    expect(plan.ops.map((o) => o.label)).toEqual(["Create test in Jira (local-1) with 2 preconditions"]);
    expect(gql(0).body.variables.jql).toBe("key in (BHPTCC-2077, BHPTCC-2075)");
    await runAll(plan.ops);
    expect(gql(1).body.variables.preconditions).toEqual(["1246749", "1246747"]);
  });

  it("refuses to create a test whose step carries markup it could not read", async () => {
    const local = localTest({
      steps: [step({ action: "do" }), step({ action: "copied from elsewhere !xray-attachment://att-9!" })],
    });
    const plan = await planPush(local, "local-1", null, deps);
    expect(plan.ops).toEqual([]);
    expect(plan.warnings).toEqual([
      "Step 2 carries Xray markup this editor could not read, and it names attachments of the test it was copied from — the test is not created. Remove that markup, or download the original from Jira.",
    ]);
  });

  it("attaches and detaches on an existing test, and leaves the unchanged ones alone", async () => {
    graph = (q) => (q.includes("getPreconditions") ? resolves(pre("BHPTCC-2080", "1246753")) : {});
    const remote = remotePulled([step({ id: "s1", action: "do" })], {}, [
      pre("BHPTCC-2075", "1246747"),
      pre("BHPTCC-2077", "1246749"),
    ]);
    const local = localTest({
      key: "BHPTCC-2234",
      preconditions: ["BHPTCC-2077", "BHPTCC-2080"],
      steps: [step({ id: "s1", action: "do" })],
    });
    const plan = await planPush(local, "BHPTCC-2234", remote, deps);
    expect(plan.ops.map((o) => o.label)).toEqual([
      "Attach precondition BHPTCC-2080",
      "Detach precondition BHPTCC-2075",
    ]);
    calls = [];
    await runAll(plan.ops);
    expect(gql(0).body.variables).toEqual({ issueId: "1300982", ids: ["1246753"] });
    expect(gql(1).body.variables).toEqual({ issueId: "1300982", ids: ["1246747"] });
    expect(gql(1).body.query).toContain("removePreconditionsFromTest");
  });

  it("warns instead of pushing a key that is not a precondition", async () => {
    graph = (q) => (q.includes("getPreconditions") ? resolves(pre("BHPTCC-2080", "1246753")) : {});
    const remote = remotePulled([step({ id: "s1", action: "do" })]);
    const local = localTest({
      key: "BHPTCC-2234",
      preconditions: ["BHPTCC-2080", "BHPTCC-9999", "a whole sentence"],
      steps: [step({ id: "s1", action: "do" })],
    });
    const plan = await planPush(local, "BHPTCC-2234", remote, deps);
    expect(plan.ops.map((o) => o.label)).toEqual(["Attach precondition BHPTCC-2080"]);
    expect(plan.warnings).toEqual([
      '"a whole sentence" is not an issue key — not attached as a precondition.',
      "BHPTCC-9999 is not a precondition of this project — not attached.",
    ]);
  });
});

describe("planPush — existing test", () => {
  it("updates fields, folder, links and steps in place", async () => {
    graph = () => ({});
    rest = () => ({});
    const remote = remotePulled(
      [
        step({ id: "s1", action: "old action", result: "keep" }),
        step({ id: "s2", action: "dropped" }),
        step({ id: "s3", action: "same", images: [img("images/old.png", "att-9")] }),
      ],
      { covers: ["BHPTCC-2174"], folder: "/Release 7.4" },
    );
    const local = localTest({
      key: "BHPTCC-2234",
      summary: "New summary",
      folder: "/Release 8.0",
      labels: ["bhp", "test", "testimus-validated"],
      covers: ["BHPTCC-2174", "BHPTCC-2175"],
      steps: [
        step({ id: "s1", action: "new action", result: "keep" }),
        step({ id: "s3", action: "same", images: [img("images/fresh.png")] }),
        step({ action: "brand new" }),
      ],
    });

    const plan = await planPush(local, "BHPTCC-2234", remote, { ...deps, remoteChanged: true });
    expect(plan.remoteChanged).toBe(true);
    expect(plan.warnings[0]).toContain("Changed in Jira");
    expect(plan.ops.map((o) => [o.label, o.kind])).toEqual([
      ["Update summary, labels", "update"],
      ["Move to folder /Release 8.0", "folder"],
      ["Link Test to BHPTCC-2175", "link"],
      ["Remove step 2", "update"],
      ["Update step 1", "update"],
      ["Upload 1 image to step 2 + Remove 1 image from step 2", "upload"],
      ["Add step 3", "update"],
    ]);

    await runAll(plan.ops);
    const put = restCalls()[0];
    expect([put.method, put.url, put.body]).toEqual([
      "PUT",
      `${JIRA}/rest/api/3/issue/BHPTCC-2234`,
      { fields: { summary: "New summary", labels: ["bhp", "test", "testimus-validated"] } },
    ]);
    expect(gql(0).body.variables).toEqual({ issueId: "1300982", folderPath: "/Release 8.0" });
    expect(gql(1).body).toMatchObject({ variables: { stepId: "s2" } });
    expect(gql(1).body.query).toContain("removeTestStep");
    expect(gql(2).body.variables).toEqual({ stepId: "s1", step: { action: "new action" } });
    expect(gql(3).body.variables).toEqual({
      stepId: "s3",
      step: {
        attachments: {
          add: [{ filename: "fresh.png", mimeType: "image/png", data: b64of("images/fresh.png") }],
          removeIds: ["att-9"],
        },
      },
    });
    expect(gql(4).body.variables).toEqual({
      issueId: "1300982",
      step: { action: "brand new", data: "", result: "", attachments: [] },
    });
  });

  it("rebuilds every step when the order changed", async () => {
    graph = () => ({});
    const remote = remotePulled([step({ id: "s1", action: "one" }), step({ id: "s2", action: "two" })]);
    const local = localTest({
      key: "BHPTCC-2234",
      steps: [step({ id: "s2", action: "two" }), step({ id: "s1", action: "one", exigence: "E" })],
    });
    const plan = await planPush(local, "BHPTCC-2234", remote, deps);
    expect(plan.ops.map((o) => o.label)).toEqual(["Remove all 2 remote steps", "Add step 1", "Add step 2"]);
    expect(plan.warnings.join(" ")).toContain("reordered");
    await runAll(plan.ops);
    expect(gql(0).body.query).toContain("removeAllTestSteps");
    expect(gql(1).body.variables.step.action).toBe("two");
    expect(gql(2).body.variables.step).toMatchObject({
      action: "one",
      customFields: [{ id: "cf-exigence", value: "E" }],
    });
  });

  it("moves an embed inside the text without touching the attachments", async () => {
    graph = () => ({});
    const images = [img("images/a.png", "att-a"), img("images/b.png", "att-b")];
    const remote = remotePulled([
      step({ id: "s1", action: 'one ![](images/a.png "width=10,height=10")', result: "r ![](images/b.png)", images }),
    ]);
    const local = localTest({
      key: "BHPTCC-2234",
      steps: [
        step({
          id: "s1",
          action: "one",
          result: 'r ![](images/b.png)\n\n![](images/a.png "width=10,height=10")',
          images,
        }),
      ],
    });
    const plan = await planPush(local, "BHPTCC-2234", remote, deps);
    expect(plan.ops.map((o) => o.label)).toEqual(["Update step 1"]);
    await runAll(plan.ops);
    expect(gql(0).body.variables.step).toEqual({
      action: "one",
      result: "r !xray-attachment://att-b!\n\n!xray-attachment://att-a|width=10,height=10!",
    });
  });

  it("uploads a new screenshot first, then embeds it with the id Xray gave it", async () => {
    graph = (q) =>
      q.includes("getTests")
        ? {
            getTests: {
              results: [
                {
                  steps: [
                    {
                      id: "s1",
                      attachments: [
                        { id: "att-a", filename: "a.png" },
                        { id: "new-1", filename: "img-77b0e1aa.png" },
                      ],
                    },
                  ],
                },
              ],
            },
          }
        : {};
    const remote = remotePulled([
      step({ id: "s1", action: 'one ![](images/a.png "width=10,height=10")', images: [img("images/a.png", "att-a")] }),
    ]);
    const local = localTest({
      key: "BHPTCC-2234",
      steps: [
        step({
          id: "s1",
          action: 'one ![](images/a.png "width=10,height=10")\n\n![](images/img-77b0e1aa.png)',
          images: [img("images/a.png", "att-a"), img("images/img-77b0e1aa.png")],
        }),
      ],
    });
    const plan = await planPush(local, "BHPTCC-2234", remote, deps);
    expect(plan.ops.map((o) => o.label)).toEqual(["Upload 1 image to step 1", "Embed 2 images in step 1"]);
    await runAll(plan.ops);
    expect(gql(0).body.variables.step).toEqual({
      attachments: {
        add: [{ filename: "img-77b0e1aa.png", mimeType: "image/png", data: b64of("images/img-77b0e1aa.png") }],
      },
    });
    expect(gql(2).body.variables).toEqual({
      stepId: "s1",
      step: {
        action: "one !xray-attachment://att-a|width=10,height=10!\n\n!xray-attachment://new-1!",
        data: "",
        result: "",
      },
    });
  });

  it("never updates a step whose Xray markup it could not read", async () => {
    const remote = remotePulled([step({ id: "s1", action: "one", result: "r" })]);
    const local = localTest({
      key: "BHPTCC-2234",
      steps: [step({ id: "s1", action: "one !xray-attachment://9a7|width=6,height=6!", result: "r2" })],
    });
    const plan = await planPush(local, "BHPTCC-2234", remote, deps);
    expect(plan.ops).toEqual([]);
    expect(plan.warnings).toEqual([
      "Step 1 carries Xray markup this editor could not read — it is left untouched in Jira.",
    ]);
  });

  it("plans nothing when local and remote are identical", async () => {
    const steps = [step({ id: "s1", action: "one", exigence: "E", images: [img("images/a.png", "att-a")] })];
    const plan = await planPush(localTest({ key: "BHPTCC-2234", steps }), "BHPTCC-2234", remotePulled(steps), deps);
    expect(plan.ops).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it("refuses to push a keyed test that was never pulled", async () => {
    await expect(planPush(localTest({ key: "BHPTCC-1" }), "BHPTCC-1", null, deps)).rejects.toThrow("never pulled");
  });

  it("refuses to build a rebuild plan when a screenshot file is gone, before removeAllTestSteps", async () => {
    const remote = remotePulled([step({ id: "s1", action: "one" }), step({ id: "s2", action: "two" })]);
    const local = localTest({
      key: "BHPTCC-2234",
      steps: [
        step({ id: "s2", action: "two" }),
        step({ id: "s1", action: "one", images: [img("images/img-gone.png")] }),
      ],
    });
    const missing = {
      ...deps,
      readImage: async (file: string) => {
        if (file === "images/img-gone.png") throw new Error("ENOENT");
        return new TextEncoder().encode(`bytes:${file}`);
      },
    };
    await expect(planPush(local, "BHPTCC-2234", remote, missing)).rejects.toThrow("images/img-gone.png is missing");
    expect(calls).toHaveLength(0);
  });

  it("fetches the steps again when Retry failed runs the embed op after a failed fetch", async () => {
    graph = (q) =>
      q.includes("getTests")
        ? {
            getTests: {
              results: [{ steps: [{ id: "s1", attachments: [{ id: "new-1", filename: "img-77b0e1aa.png" }] }] }],
            },
          }
        : {};
    const remote = remotePulled([step({ id: "s1", action: "one" })]);
    const local = localTest({
      key: "BHPTCC-2234",
      steps: [step({ id: "s1", action: "one ![](images/img-77b0e1aa.png)", images: [img("images/img-77b0e1aa.png")] })],
    });
    const plan = await planPush(local, "BHPTCC-2234", remote, deps);
    await plan.ops[0].run();
    gqlStatus = [500];
    await expect(plan.ops[1].run()).rejects.toThrow("Xray GraphQL 500");
    await expect(plan.ops[1].run()).resolves.toBeUndefined();
    expect(gql(3).body.variables.step.action).toBe("one !xray-attachment://new-1!");
  });
});

describe("bulk import payload", () => {
  it("names the folder, the fields and every step field — VERIFY against a sandbox before relying on customFields", () => {
    const out = bulkTestJson(
      {
        summary: "S",
        folder: "/Traction",
        description: "",
        labels: ["testimus-draft"],
        steps: [step({ action: "a", result: "r", exigence: "EXI_1" }), step({ result: "only" })],
      },
      deps.project,
      FIELDS,
    );
    expect(out).toEqual({
      testtype: "Manual",
      fields: { summary: "S", project: { key: "BHPTCC" }, labels: ["testimus-draft"] },
      xray_test_repository_folder: "/Traction",
      steps: [
        { action: "a", data: "", result: "r", customFields: [{ id: "cf-exigence", value: "EXI_1" }] },
        { action: ZWSP, data: "", result: "only" },
      ],
    });
  });
});

test("retryAfter reads seconds, an HTTP date, or falls back to a growing wait", () => {
  expect(retryAfter({ "retry-after": "30" }, 0)).toBe(30);
  expect(retryAfter({ "Retry-After": "30" }, 0)).toBe(30);
  expect(retryAfter({ "retry-after": "9999" }, 0)).toBe(120);
  expect(retryAfter({ "retry-after": new Date(Date.now() + 12_000).toUTCString() }, 0)).toBeGreaterThan(10);
  expect(retryAfter({}, 0)).toBe(5);
  expect(retryAfter({}, 2)).toBe(20);
});

test("a 429 is waited out, then the request is sent again; three refusals fail with the resume message", async () => {
  let n = 0;
  env.http = async (req): Promise<HttpRes> => {
    if (req.url.includes("authenticate")) return { status: 200, headers: {}, text: '"jwt"' };
    n++;
    if (n === 1) return { status: 429, headers: { "retry-after": "0.01" }, text: "" };
    return json({ data: { getFolder: { name: "/", path: "/", testsCount: 0, folders: [] } } });
  };
  await getFolderTree("1");
  expect(n).toBe(2);

  n = 0;
  resetAuth();
  env.http = async (req): Promise<HttpRes> => {
    if (req.url.includes("authenticate")) return { status: 200, headers: {}, text: '"jwt"' };
    n++;
    return { status: 429, headers: { "retry-after": "0.01" }, text: "" };
  };
  await expect(getFolderTree("1")).rejects.toThrow(/rate limit reached/);
  expect(n).toBe(4);
});
