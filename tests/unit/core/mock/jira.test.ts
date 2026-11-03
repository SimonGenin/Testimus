import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../../../src/core/env.ts";
import { textToAdf } from "../../../../src/core/lib/adf.ts";
import { MOCK_JWT, mockHttp, mockJira, mockJiraTest, resetMockJira } from "../../../../src/core/mock/jira.ts";

const XRAY = "https://xray.cloud.getxray.app";
const JIRA = "https://mock.atlassian.net";

const gql = async (query: string, variables: Record<string, unknown> = {}, token = MOCK_JWT) => {
  const res = await mockHttp({
    method: "POST",
    url: `${XRAY}/api/v2/graphql`,
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, body: JSON.parse(res.text ?? "{}") };
};
const rest = async (method: string, path: string, body?: unknown) => {
  const res = await mockHttp({ method, url: JIRA + path, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: res.text ? JSON.parse(res.text) : null };
};

beforeEach(() => {
  resetMockJira();
  mockJira.maxAttachmentBytes = 10 * 1024 * 1024;
});

describe("mock Jira + Xray for LFRPS12", () => {
  it("authenticates, and refuses GraphQL without the token", async () => {
    const auth = await mockHttp({
      method: "POST",
      url: `${XRAY}/api/v2/authenticate`,
      body: JSON.stringify({ client_id: "a", client_secret: "b" }),
    });
    expect(JSON.parse(auth.text!)).toBe(MOCK_JWT);
    expect((await gql("query{getFolder(x:1)}", {}, "nope")).status).toBe(401);
  });

  it("answers the project, myself, and the step field schema in Xray's shapes", async () => {
    expect((await rest("GET", "/rest/api/3/project/LFRPS12")).body).toMatchObject({ id: "12445", key: "LFRPS12" });
    expect((await rest("GET", "/rest/api/3/myself")).body.accountId).toBe("mock-account-1");
    const s = await gql(
      "query($projectIdOrKey:String!){ getProjectSettings(projectIdOrKey:$projectIdOrKey){ testStepSettings { fields { id name type } } } }",
      {
        projectIdOrKey: "12445",
      },
    );
    expect(s.body.data.getProjectSettings.testStepSettings.fields.map((f: any) => f.name)).toEqual([
      "action",
      "data",
      "result",
      "Exigence",
    ]);
  });

  it("serves LFRPS12-1420 as the fixture's .remote.md has it: steps, custom fields, attachment, links", async () => {
    const d = await gql("query($jql:String!){ getTests(jql:$jql,limit:1){ results { steps { id } } } }", {
      jql: "key = LFRPS12-1420",
    });
    const t = d.body.data.getTests.results[0];
    expect(t.steps.map((s: any) => s.id)).toEqual(["101", "102", "103", "104", "105"]);
    expect(t.steps[0].customFields).toEqual([{ id: "cf-exigence", name: "Exigence", value: "EXI_MOP_SPF_511_A_1650" }]);
    expect(t.steps[0].result).toContain("!xray-attachment://9001|width=320,height=160!");
    expect(t.steps[1].data).toBeNull();
    expect(t.preconditions.results[0].jira.key).toBe("LFRPS12-77");
    const issue = (await rest("GET", "/rest/api/3/issue/LFRPS12-1420?fields=summary")).body;
    expect(issue.fields.issuelinks).toEqual([
      { id: "70000", type: { name: "Test" }, outwardIssue: { key: "LFRPS12-880" } },
    ]);
    const png = await mockHttp({ method: "GET", url: t.steps[0].attachments[0].downloadLink, binary: true });
    expect([...png.bytes!.slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
  });

  it("keeps the folder tree with direct counts", async () => {
    const d = await gql(
      "query($projectId:String!,$path:String!){ getFolder(projectId:$projectId,path:$path){ name } }",
      {
        projectId: "12445",
        path: "/Traction",
      },
    );
    expect(d.body.data.getFolder).toEqual({
      name: "Traction",
      path: "/Traction",
      testsCount: 0,
      folders: [
        { name: "Disjoncteurs", path: "/Traction/Disjoncteurs", testsCount: 2, folders: [] },
        { name: "Sectionneurs", path: "/Traction/Sectionneurs", testsCount: 2, folders: [] },
      ],
    });
  });

  it("is stateful: a created test, a step update and a field PUT are what the next read answers", async () => {
    const c = await gql("mutation{ createTest(jira:{fields:$jira}) }", {
      jira: { project: { key: "LFRPS12" }, summary: "New", labels: ["testimus-draft"] },
      steps: [{ action: "a", data: "", result: "r", customFields: [{ id: "cf-exigence", value: "E1" }] }],
      folder: "/Signalisation",
    });
    const key = c.body.data.createTest.test.jira.key;
    const t = mockJiraTest(key)!;
    expect(t).toMatchObject({ summary: "New", folder: "/Signalisation", labels: ["testimus-draft"] });
    await gql("mutation{ updateTestStep(stepId:$s) }", {
      stepId: t.steps[0].id,
      step: { result: "r2", customFields: [{ id: "cf-exigence", value: "" }] },
    });
    expect(t.steps[0]).toMatchObject({ result: "r2", custom: {} });
    expect((await rest("PUT", `/rest/api/3/issue/${key}`, { fields: { summary: "Renamed" } })).status).toBe(204);
    expect(mockJiraTest(key)!.summary).toBe("Renamed");
    resetMockJira();
    expect(mockJiraTest(key)).toBeUndefined();
  });

  it("refuses an unknown custom field, a step with no action, and an attachment over the limit", async () => {
    const bad = await gql("mutation{ addTestStep(issueId:$i) }", {
      issueId: "41398",
      step: { action: "a", customFields: [{ id: "cf-nope", value: "x" }] },
    });
    expect(bad.body.errors[0].message).toBe("Custom field cf-nope does not exist.");
    const empty = await gql("mutation{ addTestStep(issueId:$i) }", { issueId: "41398", step: { action: "" } });
    expect(empty.body.errors[0].message).toContain("'action'");

    mockJira.maxAttachmentBytes = 4;
    const big = await gql("mutation{ updateTestStep(stepId:$s) }", {
      stepId: "201",
      step: {
        action: "changed",
        attachments: { add: [{ filename: "big.png", mimeType: "image/png", data: "AAAAAAAA" }] },
      },
    });
    expect(big.body.errors[0].message).toMatch(/^Attachment big\.png is 6 bytes — over the 4 bytes Jira accepts\.$/);
    expect(mockJiraTest("LFRPS12-1398")!.steps[0].action).toBe(
      "Clic droit sur le disjoncteur D 4 de la vue de traction.",
    );
  });
});

const gqlBody = async (query: string, variables?: Record<string, unknown>) => {
  const res = await mockHttp({
    method: "POST",
    url: `${XRAY}/api/v2/graphql`,
    headers: { Authorization: `Bearer ${MOCK_JWT}` },
    body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
  });
  return JSON.parse(res.text ?? "{}");
};
const restRes = async (method: string, path: string, body?: unknown, binary = false) => {
  const res = await mockHttp({
    method,
    url: JIRA + path,
    body: body === undefined ? undefined : JSON.stringify(body),
    binary,
  });
  return { status: res.status, res, body: res.text ? JSON.parse(res.text) : null };
};
const b64 = (n: number) => Buffer.alloc(n, 1).toString("base64");
const errorOf = (r: any) => r.errors?.[0]?.message;

afterEach(() => {
  env.mock = false;
});

describe("mock graphql mutations", () => {
  it("adds, updates and removes steps, and refuses unknown ids", async () => {
    const add = await gqlBody("mutation{ addTestStep(issueId:$i,step:$s){ id } }", {
      issueId: "41398",
      step: { action: "new", data: "d", attachments: [{ filename: "a.png", data: b64(10) }] },
    });
    const id = add.data.addTestStep.id;
    const t = mockJiraTest("LFRPS12-1398")!;
    expect(t.steps.at(-1)).toMatchObject({ id, action: "new", data: "d", attachments: [{ filename: "a.png" }] });

    await gqlBody("mutation{ updateTestStep(stepId:$s,step:$x){ warnings } }", {
      stepId: id,
      step: {
        result: "r",
        customFields: [
          { id: "cf-exigence", value: 12 },
          { id: "cf-exigence", value: null },
        ],
        attachments: { removeIds: [t.steps.at(-1)!.attachments[0].id] },
      },
    });
    expect(t.steps.at(-1)).toMatchObject({ result: "r", custom: {}, attachments: [] });

    await gqlBody("mutation{ updateTestStep(stepId:$s,step:$x){ warnings } }", { stepId: id });
    await gqlBody("mutation{ updateTestStep(stepId:$s,step:$x){ warnings } }", {
      stepId: id,
      step: { attachments: { add: [{ filename: "b.png", data: b64(2) }] } },
    });
    expect(t.steps.at(-1)!.attachments.map((a) => a.filename)).toEqual(["b.png"]);
    await gqlBody("mutation{ updateTestStep(stepId:$s,step:$x){ warnings } }", {
      stepId: id,
      step: { attachments: {} },
    });
    expect(t.steps.at(-1)!.attachments).toHaveLength(1);

    expect((await gqlBody("mutation{ removeTestStep(stepId:$s) }", { stepId: id })).data.removeTestStep).toBe("ok");
    expect(t.steps.map((s) => s.id)).toEqual(["201"]);
    expect(errorOf(await gqlBody("mutation{ removeTestStep(stepId:$s) }", { stepId: "zzz" }))).toBe(
      "Step zzz not found.",
    );
    expect(errorOf(await gqlBody("mutation{ addTestStep(issueId:$i,step:$s){ id } }", { issueId: "0" }))).toBe(
      "Test with id 0 not found.",
    );
    expect(errorOf(await gqlBody("mutation{ addTestStep(issueId:$i,step:$s){ id } }", { issueId: "41398" }))).toMatch(
      /action/,
    );
  });

  it("removes all steps, moves the folder, attaches and detaches preconditions", async () => {
    await gqlBody("mutation{ removeAllTestSteps(issueId:$i) }", { issueId: "41401" });
    await gqlBody("mutation{ updateTestFolder(issueId:$i,folderPath:$f) }", { issueId: "41401", folderPath: "/New" });
    await gqlBody("mutation{ addPreconditionsToTest(issueId:$i,preconditionIssueIds:$ids){ warning } }", {
      issueId: "41401",
      ids: ["30078", "30077"],
    });
    const t = mockJiraTest("LFRPS12-1401")!;
    expect(t).toMatchObject({ steps: [], folder: "/New", preconditions: ["30077", "30078"] });
    await gqlBody("mutation{ addPreconditionsToTest(issueId:$i,preconditionIssueIds:$ids){ warning } }", {
      issueId: "41401",
    });
    await gqlBody("mutation{ removePreconditionsFromTest(issueId:$i,preconditionIssueIds:$ids) }", {
      issueId: "41401",
      ids: ["30077"],
    });
    expect(t.preconditions).toEqual(["30078"]);
    await gqlBody("mutation{ removePreconditionsFromTest(issueId:$i,preconditionIssueIds:$ids) }", {
      issueId: "41401",
    });
    expect(t.preconditions).toEqual(["30078"]);
  });

  it("creates a test with defaults, and refuses a wrong project, no summary or an ADF description", async () => {
    const r = await gqlBody("mutation{ createTest(jira:$j){ test { issueId } } }", {
      jira: { project: { key: "LFRPS12" }, summary: "S" },
    });
    const key = r.data.createTest.test.jira.key;
    expect(mockJiraTest(key)).toMatchObject({ folder: "/", labels: [], description: "", preconditions: [], steps: [] });
    expect(errorOf(await gqlBody("mutation{ createTest(jira:$j){ test { issueId } } }", {}))).toBe(
      "project: project undefined does not exist",
    );
    expect(
      errorOf(
        await gqlBody("mutation{ createTest(jira:$j){ test { issueId } } }", { jira: { project: { key: "LFRPS12" } } }),
      ),
    ).toMatch(/summary/);
    expect(
      errorOf(
        await gqlBody("mutation{ createTest(jira:$j){ test { issueId } } }", {
          jira: { project: { key: "LFRPS12" }, summary: "S", description: { type: "doc" } },
        }),
      ),
    ).toMatch(/must be a string/);
  });

  it("names a too large attachment in KB, MB or bytes", async () => {
    const tooBig = async (limit: number, n: number) => {
      mockJira.maxAttachmentBytes = limit;
      return errorOf(
        await gqlBody("mutation{ addTestStep(issueId:$i,step:$s){ id } }", {
          issueId: "41398",
          step: { action: "a", attachments: [{ filename: "x.png", data: b64(n) }] },
        }),
      );
    };
    expect(await tooBig(10, 20)).toBe("Attachment x.png is 20 bytes — over the 10 bytes Jira accepts.");
    expect(await tooBig(1024, 2048)).toBe("Attachment x.png is 2 KB — over the 1 KB Jira accepts.");
    expect(await tooBig(1048576, 1572864)).toBe("Attachment x.png is 1.5 MB — over the 1 MB Jira accepts.");
  });
});

describe("mock graphql queries", () => {
  it("answers no settings for another project, and an unsupported query with an error", async () => {
    expect(
      (await gqlBody("query{ getProjectSettings(projectIdOrKey:$p){ x } }", { projectIdOrKey: "X" })).data,
    ).toEqual({
      getProjectSettings: null,
    });
    expect((await gqlBody("query{ getProjectSettings(projectIdOrKey:$p){ x } }")).data.getProjectSettings).toBeNull();
    expect(errorOf(await gqlBody("query{ nothing }"))).toBe("mock: unsupported GraphQL query");
  });

  it("serves the root folder, an unknown one as null, and a folder known only through a test", async () => {
    expect((await gqlBody("query{ getFolder(projectId:$p,path:$x){ name } }")).data.getFolder.name).toBe("/");
    expect(
      (await gqlBody("query{ getFolder(projectId:$p,path:$x){ name } }", { path: "/Nope" })).data.getFolder,
    ).toBeNull();
    await gqlBody("mutation{ updateTestFolder(issueId:$i,folderPath:$f) }", {
      issueId: "41411",
      folderPath: "/Only/Here",
    });
    const f = (await gqlBody("query{ getFolder(projectId:$p,path:$x){ name } }", { path: "/Only/Here" })).data
      .getFolder;
    expect(f).toMatchObject({ name: "Here", path: "/Only/Here", testsCount: 1 });
  });

  it("lists tests by folder, with or without descendants, and pages them", async () => {
    const keys = async (vars: Record<string, unknown>) =>
      (await gqlBody("query{ getTests(folder:$f){ results { jira } } }", vars)).data.getTests.results.map(
        (t: any) => t.jira.key,
      );
    expect(await keys({ folder: { path: "/Traction" } })).toEqual([]);
    expect(await keys({ folder: { path: "/Traction", includeDescendants: true } })).toHaveLength(4);
    expect(await keys({ folder: { path: "", includeDescendants: true } })).toHaveLength(6);
    expect(await keys({ folder: { path: "/Signalisation" }, start: 1, limit: 1 })).toEqual(["LFRPS12-1411"]);
    await gqlBody("mutation{ updateTestFolder(issueId:$i,folderPath:$f) }", { issueId: "41411", folderPath: "" });
    expect(await keys({ folder: { path: "/" } })).toEqual(["LFRPS12-1411"]);
    expect(await keys({})).toHaveLength(6);
  });

  it("matches jql by key list, escaped summary words and linked issues", async () => {
    const keys = async (jql: string) =>
      (await gqlBody("query{ getTests(jql:$j){ results { jira } } }", { jql })).data.getTests.results.map(
        (t: any) => t.jira.key,
      );
    expect(await keys("key in (LFRPS12-1398, LFRPS12-1401)")).toEqual(["LFRPS12-1398", "LFRPS12-1401"]);
    expect(await keys('summary ~ "signal \\"rouge"')).toEqual([]);
    expect(await keys('summary ~ "signal rouge"')).toEqual(["LFRPS12-1410"]);
    expect(await keys('summary ~ ""')).toHaveLength(6);
    expect(await keys('issue in linkedIssues("LFRPS12-880")')).toEqual(["LFRPS12-1420"]);
    expect(await keys("project = LFRPS12")).toHaveLength(6);
  });

  it("filters preconditions by key in the jql", async () => {
    const r = await gqlBody("query{ getPreconditions(jql:$j){ total } }", { jql: "key in (LFRPS12-78)" });
    expect(r.data.getPreconditions.results.map((p: any) => p.jira.key)).toEqual(["LFRPS12-78"]);
  });
});

describe("mock REST", () => {
  it("refuses authentication without a secret and graphql without a header", async () => {
    const auth = await mockHttp({ method: "POST", url: `${XRAY}/api/v2/authenticate` });
    expect(auth.status).toBe(401);
    const g = await mockHttp({ method: "POST", url: `${XRAY}/api/v2/graphql`, body: "{}" });
    expect(g.status).toBe(401);
  });

  it("refuses an unknown project, attachment and issue, and answers an attachment as text when not binary", async () => {
    expect((await restRes("GET", "/rest/api/3/project/NOPE")).status).toBe(404);
    expect((await restRes("GET", "/rest/api/3/project/12445")).status).toBe(200);
    expect((await restRes("GET", "/rest/api/3/attachment/content/none")).status).toBe(404);
    const text = await restRes("GET", "/rest/api/3/attachment/content/9001");
    expect(text.res.text).toBe("");
    const bin = await restRes("GET", "/rest/api/3/attachment/content/9001", undefined, true);
    expect(bin.res.bytes?.length).toBeGreaterThan(0);
    expect((await restRes("GET", "/rest/api/3/issue/LFRPS12-1")).status).toBe(404);
    expect((await restRes("POST", "/rest/api/3/issue/LFRPS12-1420")).status).toBe(404);
    expect((await restRes("DELETE", "/rest/api/9")).status).toBe(404);
  });

  it("reads an issue without description, updates only the fields sent, and an empty PUT changes nothing", async () => {
    const got = await restRes("GET", "/rest/api/3/issue/LFRPS12-1405");
    expect(got.body.fields.description).toBeNull();
    expect((await restRes("PUT", "/rest/api/3/issue/LFRPS12-1405", { fields: { labels: ["x"] } })).status).toBe(204);
    expect(
      (await restRes("PUT", "/rest/api/3/issue/LFRPS12-1405", { fields: { description: textToAdf("D") } })).status,
    ).toBe(204);
    expect((await restRes("PUT", "/rest/api/3/issue/LFRPS12-1405")).status).toBe(204);
    expect(mockJiraTest("LFRPS12-1405")).toMatchObject({
      labels: ["x"],
      description: "D",
      summary: expect.any(String),
    });
  });

  it("links once, and refuses a link from an unknown issue", async () => {
    const link = { type: { name: "Test" }, inwardIssue: { key: "LFRPS12-1398" }, outwardIssue: { key: "LFRPS12-9" } };
    expect((await restRes("POST", "/rest/api/3/issueLink", link)).status).toBe(201);
    await restRes("POST", "/rest/api/3/issueLink", link);
    expect(mockJiraTest("LFRPS12-1398")!.links).toEqual([{ type: "Test", key: "LFRPS12-9" }]);
    expect((await restRes("POST", "/rest/api/3/issueLink", {})).status).toBe(404);
  });

  it("waits a little in --mock mode, longer for an attachment", async () => {
    env.mock = true;
    const t0 = Date.now();
    await restRes("GET", "/rest/api/3/myself");
    await restRes("GET", "/rest/api/3/attachment/content/9001", undefined, true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(200);
  });

  it("ends its wait when the request is cancelled, like a real request", async () => {
    env.mock = true;
    const ctrl = new AbortController();
    const t0 = Date.now();
    const req = mockHttp({
      method: "GET",
      url: "https://mock.atlassian.net/rest/api/3/attachment/content/9001",
      binary: true,
      signal: ctrl.signal,
    });
    ctrl.abort();
    await expect(req).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(150);
  });
});
