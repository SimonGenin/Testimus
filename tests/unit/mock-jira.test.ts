import { beforeEach, describe, expect, it } from "vitest";
import { MOCK_JWT, mockHttp, mockJira, mockJiraTest, resetMockJira } from "../../src/core/mock/jira.ts";

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
