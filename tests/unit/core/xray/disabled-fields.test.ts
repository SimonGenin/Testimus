import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../../../src/core/env.ts";
import { resetAuth } from "../../../../src/core/lib/jira/http.ts";
import { planPush } from "../../../../src/core/lib/jira/push.ts";
import type { PulledTest } from "../../../../src/core/lib/jira/read.ts";
import { readXray, writeXray } from "../../../../src/core/lib/project.ts";
import { localTestRef, readTest, writeTest } from "../../../../src/core/lib/store.ts";
import { checkRemote, forCompare, pullToLocal } from "../../../../src/core/lib/sync/pull.ts";
import { mockHttp, resetMockJira } from "../../../../src/core/mock/jira.ts";
import type { Step, StepImage, Test, XrayField } from "../../../../src/core/types.ts";
import { fake, fakeXray, gqlCalls } from "./fake-xray.ts";

const step = (p: {
  id?: string;
  action?: string;
  data?: string;
  images?: StepImage[];
  extra?: Record<string, string>;
}): Step => ({
  ...(p.id ? { id: p.id } : {}),
  fields: { Action: p.action ?? "a", Data: p.data ?? "", "Expected Result": "r", ...(p.extra ?? {}) },
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
  { id: "data", name: "Data", type: "text", builtin: true, disabled: true },
  { id: "result", name: "Expected Result", type: "text", builtin: true },
  { id: "cf-old", name: "Retired", type: "text", builtin: false, disabled: true },
  { id: "cf-ctl", name: "Contrôle", type: "text", builtin: false },
];
const deps = {
  project: { id: "1", key: "P", name: "P", testIssueTypeId: "2", testIssueTypeName: "Test" },
  accountId: "acc",
  readImage: async (file: string) => new TextEncoder().encode(file),
  fields: FIELDS,
  labelPrefix: "testimus-",
};
const remote = (steps: Step[]): PulledTest => ({
  issueId: "100",
  images: [],
  preconditions: [],
  test: localTest({ key: "P-1", steps }),
});
const runAll = async (ops: Array<{ run: () => Promise<void> }>) => {
  for (const op of ops) await op.run();
};

describe("a step field switched off in Xray stays local on push", () => {
  fakeXray();

  it("creates the test without it, and says which steps keep text in it", async () => {
    fake.graph = () => ({ createTest: { test: { issueId: "9", jira: { key: "P-9" } } } });
    const t = localTest({
      steps: [step({ data: "d1", extra: { Retired: "x", Contrôle: "c" } }), step({ data: "" }), step({ data: "d3" })],
    });
    const plan = await planPush(t, "t1", null, deps);
    expect(plan.warnings).toEqual([
      "Data is switched off in Xray — what step 1, 3 hold in it stays in Testimus and is not pushed.",
      "Retired is switched off in Xray — what step 1 holds in it stays in Testimus and is not pushed.",
    ]);
    await runAll(plan.ops);
    const steps = gqlCalls().find((c) => c.body.query.includes("createTest"))!.body.variables.steps;
    expect(steps.map((s: { data: string }) => s.data)).toEqual(["", "", ""]);
    expect(steps[0].customFields).toEqual([{ id: "cf-ctl", value: "c" }]);
  });

  it("updates a step without sending a changed disabled field, and plans nothing when only it changed", async () => {
    const r = remote([step({ id: "s1", data: "" }), step({ id: "s2", action: "b" })]);
    const t = localTest({
      key: "P-1",
      steps: [step({ id: "s1", data: "local only", extra: { Retired: "y" } }), step({ id: "s2", action: "b2" })],
    });
    const plan = await planPush(t, "t1", r, deps);
    expect(plan.ops.map((o) => o.label)).toEqual(["Update step 2"]);
    await runAll(plan.ops);
    expect(gqlCalls()[0].body.variables.step).toEqual({ action: "b2" });
  });

  it("a rebuild and an added step leave it empty, and an image shown only in it is not embedded", async () => {
    const r = remote([step({ id: "s1" }), step({ id: "s2" })]);
    const shot = { file: "images/x.png" };
    const reordered = localTest({
      key: "P-1",
      steps: [step({ id: "s2", data: "d" }), step({ id: "s1", data: "![](images/x.png)", images: [shot] })],
    });
    const rebuild = await planPush(reordered, "t1", r, deps);
    expect(rebuild.ops.map((o) => o.label)).toEqual(["Remove all 2 remote steps", "Add step 1", "Add step 2"]);
    await runAll(rebuild.ops);
    const added = gqlCalls().filter((c) => c.body.query.includes("addTestStep"));
    expect(added.map((c) => c.body.variables.step.data)).toEqual(["", ""]);

    const appended = localTest({ key: "P-1", steps: [step({ id: "s1" }), step({ id: "s2" }), step({ data: "new" })] });
    const plan = await planPush(appended, "t1", r, deps);
    expect(plan.ops.map((o) => o.label)).toEqual(["Add step 3"]);
  });

  it("embeds the images of the fields still on, never writing the disabled one", async () => {
    fake.graph = (q) =>
      q.includes("createTest")
        ? { createTest: { test: { issueId: "9", jira: { key: "P-9" } } } }
        : q.includes("getTests")
          ? { getTests: { results: [{ steps: [{ id: "n1", attachments: [{ id: "a1", filename: "x.png" }] }] }] } }
          : {};
    const t = localTest({
      steps: [
        step({ action: "see ![](images/x.png)", data: "also ![](images/x.png)", images: [{ file: "images/x.png" }] }),
      ],
    });
    const plan = await planPush(t, "t1", null, deps);
    expect(plan.ops.map((o) => o.label)).toEqual(["Create test in Jira (t1)", "Embed 1 image in step 1"]);
    await runAll(plan.ops);
    const embed = gqlCalls().at(-1)!.body.variables.step;
    expect(embed.action).toBe("see !xray-attachment://a1!");
    expect(embed.data).toBe("");
  });
});

describe("a step field switched off in Xray stays local on pull", () => {
  const http = env.http;
  let project = "";
  afterAll(() => {
    env.http = http;
  });
  beforeEach(() => {
    project = join(mkdtempSync(join(tmpdir(), "testimus-off-")), "LFRPS12");
    cpSync(new URL("../../../fixtures/project/", import.meta.url), project, { recursive: true });
    const dir = join(env.homeDir(), ".atlassian");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "credentials.json"),
      JSON.stringify({ baseUrl: "https://mock.atlassian.net/wiki", email: "tester@example.com", token: "t" }),
    );
    writeFileSync(join(dir, "xray_credentials.json"), JSON.stringify({ clientId: "id", clientSecret: "secret" }));
    resetMockJira();
    resetAuth();
    env.http = mockHttp;
  });

  it("keeps the local text of the field, and Jira is not seen changed for it", async () => {
    await pullToLocal(project, "LFRPS12-1420");
    const x = readXray(project);
    writeXray(project, { ...x, fields: x.fields.map((f) => (f.name === "Data" ? { ...f, disabled: true } : f)) });
    const { test } = readTest(project, "LFRPS12-1420");
    test.steps[0].fields.Data = "kept here";
    writeTest(project, "LFRPS12-1420", test);
    await pullToLocal(project, "LFRPS12-1420");
    expect(readTest(project, "LFRPS12-1420").test.steps[0].fields.Data).toBe("kept here");
    expect(localTestRef(project, "LFRPS12-1420")).toMatchObject({ sync: "synced" });
    expect(await checkRemote(project, "LFRPS12-1420")).toBe("unchanged");
  });

  it("forCompare leaves the local-only fields out", () => {
    const t = localTest({ steps: [step({ data: "d" })] });
    expect(forCompare(t, ["Data"])).toBe(forCompare(localTest({ steps: [step({ data: "" })] })));
  });
});
