import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../src/core/env.ts";
import { textToAdf } from "../../src/core/lib/adf.ts";
import { MOCK_JWT, mockHttp, mockJira, mockJiraTest, resetMockJira } from "../../src/core/mock/jira.ts";

const XRAY = "https://xray.cloud.getxray.app";
const JIRA = "https://mock.atlassian.net";

const gql = async (query: string, variables?: Record<string, unknown>) => {
  const res = await mockHttp({
    method: "POST",
    url: `${XRAY}/api/v2/graphql`,
    headers: { Authorization: `Bearer ${MOCK_JWT}` },
    body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
  });
  return JSON.parse(res.text ?? "{}");
};
const rest = async (method: string, path: string, body?: unknown, binary = false) => {
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

beforeEach(() => {
  resetMockJira();
  mockJira.maxAttachmentBytes = 10 * 1024 * 1024;
});
afterEach(() => {
  env.mock = false;
});

describe("mock graphql mutations", () => {
  it("adds, updates and removes steps, and refuses unknown ids", async () => {
    const add = await gql("mutation{ addTestStep(issueId:$i,step:$s){ id } }", {
      issueId: "41398",
      step: { action: "new", data: "d", attachments: [{ filename: "a.png", data: b64(10) }] },
    });
    const id = add.data.addTestStep.id;
    const t = mockJiraTest("LFRPS12-1398")!;
    expect(t.steps.at(-1)).toMatchObject({ id, action: "new", data: "d", attachments: [{ filename: "a.png" }] });

    await gql("mutation{ updateTestStep(stepId:$s,step:$x){ warnings } }", {
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

    await gql("mutation{ updateTestStep(stepId:$s,step:$x){ warnings } }", { stepId: id });
    await gql("mutation{ updateTestStep(stepId:$s,step:$x){ warnings } }", {
      stepId: id,
      step: { attachments: { add: [{ filename: "b.png", data: b64(2) }] } },
    });
    expect(t.steps.at(-1)!.attachments.map((a) => a.filename)).toEqual(["b.png"]);
    await gql("mutation{ updateTestStep(stepId:$s,step:$x){ warnings } }", { stepId: id, step: { attachments: {} } });
    expect(t.steps.at(-1)!.attachments).toHaveLength(1);

    expect((await gql("mutation{ removeTestStep(stepId:$s) }", { stepId: id })).data.removeTestStep).toBe("ok");
    expect(t.steps.map((s) => s.id)).toEqual(["201"]);
    expect(errorOf(await gql("mutation{ removeTestStep(stepId:$s) }", { stepId: "zzz" }))).toBe("Step zzz not found.");
    expect(errorOf(await gql("mutation{ addTestStep(issueId:$i,step:$s){ id } }", { issueId: "0" }))).toBe(
      "Test with id 0 not found.",
    );
    expect(errorOf(await gql("mutation{ addTestStep(issueId:$i,step:$s){ id } }", { issueId: "41398" }))).toMatch(
      /action/,
    );
  });

  it("removes all steps, moves the folder, attaches and detaches preconditions", async () => {
    await gql("mutation{ removeAllTestSteps(issueId:$i) }", { issueId: "41401" });
    await gql("mutation{ updateTestFolder(issueId:$i,folderPath:$f) }", { issueId: "41401", folderPath: "/New" });
    await gql("mutation{ addPreconditionsToTest(issueId:$i,preconditionIssueIds:$ids){ warning } }", {
      issueId: "41401",
      ids: ["30078", "30077"],
    });
    const t = mockJiraTest("LFRPS12-1401")!;
    expect(t).toMatchObject({ steps: [], folder: "/New", preconditions: ["30077", "30078"] });
    await gql("mutation{ addPreconditionsToTest(issueId:$i,preconditionIssueIds:$ids){ warning } }", {
      issueId: "41401",
    });
    await gql("mutation{ removePreconditionsFromTest(issueId:$i,preconditionIssueIds:$ids) }", {
      issueId: "41401",
      ids: ["30077"],
    });
    expect(t.preconditions).toEqual(["30078"]);
    await gql("mutation{ removePreconditionsFromTest(issueId:$i,preconditionIssueIds:$ids) }", { issueId: "41401" });
    expect(t.preconditions).toEqual(["30078"]);
  });

  it("creates a test with defaults, and refuses a wrong project, no summary or an ADF description", async () => {
    const r = await gql("mutation{ createTest(jira:$j){ test { issueId } } }", {
      jira: { project: { key: "LFRPS12" }, summary: "S" },
    });
    const key = r.data.createTest.test.jira.key;
    expect(mockJiraTest(key)).toMatchObject({ folder: "/", labels: [], description: "", preconditions: [], steps: [] });
    expect(errorOf(await gql("mutation{ createTest(jira:$j){ test { issueId } } }", {}))).toBe(
      "project: project undefined does not exist",
    );
    expect(
      errorOf(
        await gql("mutation{ createTest(jira:$j){ test { issueId } } }", { jira: { project: { key: "LFRPS12" } } }),
      ),
    ).toMatch(/summary/);
    expect(
      errorOf(
        await gql("mutation{ createTest(jira:$j){ test { issueId } } }", {
          jira: { project: { key: "LFRPS12" }, summary: "S", description: { type: "doc" } },
        }),
      ),
    ).toMatch(/must be a string/);
  });

  it("names a too large attachment in KB, MB or bytes", async () => {
    const tooBig = async (limit: number, n: number) => {
      mockJira.maxAttachmentBytes = limit;
      return errorOf(
        await gql("mutation{ addTestStep(issueId:$i,step:$s){ id } }", {
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
    expect((await gql("query{ getProjectSettings(projectIdOrKey:$p){ x } }", { projectIdOrKey: "X" })).data).toEqual({
      getProjectSettings: null,
    });
    expect((await gql("query{ getProjectSettings(projectIdOrKey:$p){ x } }")).data.getProjectSettings).toBeNull();
    expect(errorOf(await gql("query{ nothing }"))).toBe("mock: unsupported GraphQL query");
  });

  it("serves the root folder, an unknown one as null, and a folder known only through a test", async () => {
    expect((await gql("query{ getFolder(projectId:$p,path:$x){ name } }")).data.getFolder.name).toBe("/");
    expect(
      (await gql("query{ getFolder(projectId:$p,path:$x){ name } }", { path: "/Nope" })).data.getFolder,
    ).toBeNull();
    await gql("mutation{ updateTestFolder(issueId:$i,folderPath:$f) }", { issueId: "41411", folderPath: "/Only/Here" });
    const f = (await gql("query{ getFolder(projectId:$p,path:$x){ name } }", { path: "/Only/Here" })).data.getFolder;
    expect(f).toMatchObject({ name: "Here", path: "/Only/Here", testsCount: 1 });
  });

  it("lists tests by folder, with or without descendants, and pages them", async () => {
    const keys = async (vars: Record<string, unknown>) =>
      (await gql("query{ getTests(folder:$f){ results { jira } } }", vars)).data.getTests.results.map(
        (t: any) => t.jira.key,
      );
    expect(await keys({ folder: { path: "/Traction" } })).toEqual([]);
    expect(await keys({ folder: { path: "/Traction", includeDescendants: true } })).toHaveLength(4);
    expect(await keys({ folder: { path: "", includeDescendants: true } })).toHaveLength(6);
    expect(await keys({ folder: { path: "/Signalisation" }, start: 1, limit: 1 })).toEqual(["LFRPS12-1411"]);
    await gql("mutation{ updateTestFolder(issueId:$i,folderPath:$f) }", { issueId: "41411", folderPath: "" });
    expect(await keys({ folder: { path: "/" } })).toEqual(["LFRPS12-1411"]);
    expect(await keys({})).toHaveLength(6);
  });

  it("matches jql by key list, escaped summary words and linked issues", async () => {
    const keys = async (jql: string) =>
      (await gql("query{ getTests(jql:$j){ results { jira } } }", { jql })).data.getTests.results.map(
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
    const r = await gql("query{ getPreconditions(jql:$j){ total } }", { jql: "key in (LFRPS12-78)" });
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
    expect((await rest("GET", "/rest/api/3/project/NOPE")).status).toBe(404);
    expect((await rest("GET", "/rest/api/3/project/12445")).status).toBe(200);
    expect((await rest("GET", "/rest/api/3/attachment/content/none")).status).toBe(404);
    const text = await rest("GET", "/rest/api/3/attachment/content/9001");
    expect(text.res.text).toBe("");
    const bin = await rest("GET", "/rest/api/3/attachment/content/9001", undefined, true);
    expect(bin.res.bytes?.length).toBeGreaterThan(0);
    expect((await rest("GET", "/rest/api/3/issue/LFRPS12-1")).status).toBe(404);
    expect((await rest("POST", "/rest/api/3/issue/LFRPS12-1420")).status).toBe(404);
    expect((await rest("DELETE", "/rest/api/9")).status).toBe(404);
  });

  it("reads an issue without description, updates only the fields sent, and an empty PUT changes nothing", async () => {
    const got = await rest("GET", "/rest/api/3/issue/LFRPS12-1405");
    expect(got.body.fields.description).toBeNull();
    expect((await rest("PUT", "/rest/api/3/issue/LFRPS12-1405", { fields: { labels: ["x"] } })).status).toBe(204);
    expect(
      (await rest("PUT", "/rest/api/3/issue/LFRPS12-1405", { fields: { description: textToAdf("D") } })).status,
    ).toBe(204);
    expect((await rest("PUT", "/rest/api/3/issue/LFRPS12-1405")).status).toBe(204);
    expect(mockJiraTest("LFRPS12-1405")).toMatchObject({
      labels: ["x"],
      description: "D",
      summary: expect.any(String),
    });
  });

  it("links once, and refuses a link from an unknown issue", async () => {
    const link = { type: { name: "Test" }, inwardIssue: { key: "LFRPS12-1398" }, outwardIssue: { key: "LFRPS12-9" } };
    expect((await rest("POST", "/rest/api/3/issueLink", link)).status).toBe(201);
    await rest("POST", "/rest/api/3/issueLink", link);
    expect(mockJiraTest("LFRPS12-1398")!.links).toEqual([{ type: "Test", key: "LFRPS12-9" }]);
    expect((await rest("POST", "/rest/api/3/issueLink", {})).status).toBe(404);
  });

  it("waits a little in --mock mode, longer for an attachment", async () => {
    env.mock = true;
    const t0 = Date.now();
    await rest("GET", "/rest/api/3/myself");
    await rest("GET", "/rest/api/3/attachment/content/9001", undefined, true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(200);
  });
});
