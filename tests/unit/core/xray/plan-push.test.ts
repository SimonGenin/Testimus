import { describe, expect, it } from "vitest";
import { planPush } from "../../../../src/core/lib/jira/push.ts";
import type { PulledTest } from "../../../../src/core/lib/jira/read.ts";
import type { Precondition, Step, StepImage, Test, XrayField } from "../../../../src/core/types.ts";

import { fake, fakeXray, gqlCalls } from "./fake-xray.ts";

fakeXray();

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
    fake.graph = (q) =>
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
    fake.graph = (q) =>
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
    fake.graph = (q) => (q.includes("getTests") ? { getTests: { results: [{ steps: [{ data: "x" }] }] } } : {});
    const plan = await planPush(t, "t1", remote([step({ id: "s1" })]), deps);
    const embed = plan.ops.find((o) => o.kind === "embed")!;
    await expect(embed.run()).rejects.toThrow("Step 1 is not in Jira");
  });

  it("an embed reads a step without attachments", async () => {
    const t = localTest({
      key: "P-1",
      steps: [step({ id: "s1", action: "![](images/a.png)", images: [img("images/a.png")] })],
    });
    fake.graph = (q) => (q.includes("getTests") ? { getTests: { results: [{ steps: [{ id: "s1" }] }] } } : {});
    const plan = await planPush(t, "t1", remote([step({ id: "s1" })]), deps);
    await plan.ops.find((o) => o.kind === "embed")!.run();
    expect(gqlCalls().at(-1)?.body.variables.step.action).toBe("​");
  });

  it("an embed of a test with no step answer fails too", async () => {
    const t = localTest({
      key: "P-1",
      steps: [step({ id: "s1", action: "![](images/a.png)", images: [img("images/a.png")] })],
    });
    fake.graph = (q) => (q.includes("getTests") ? { getTests: {} } : {});
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
    expect(fake.calls.at(-1)?.body.fields.description.type).toBe("doc");
  });

  it("keeps the folder when the local one is empty", async () => {
    const plan = await planPush(localTest({ key: "P-1", folder: "" }), "t1", remote([], { folder: "/Other" }), deps);
    expect(plan.ops).toEqual([]);
  });

  it("passes on the warning Xray gives when attaching, and detaches one", async () => {
    fake.graph = (q) =>
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
    fake.graph = (q) =>
      q.includes("getPreconditions")
        ? { getPreconditions: { total: 1, results: [{ issueId: 5, jira: { key: "P-5" } }] } }
        : { addPreconditionsToTest: null };
    const plan = await planPush(localTest({ key: "P-1", preconditions: ["P-5"] }), "t1", remote([]), deps);
    await runAll(plan.ops);
    expect(plan.warnings).toEqual([]);
    fake.graph = () => ({ getPreconditions: { total: 0, results: [] } });
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
    fake.graph = (q) =>
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

  it("uploads an image whose path ends with a separator under its whole path", async () => {
    const t = localTest({ steps: [step({ action: "a", images: [img("images/")] })] });
    fake.graph = (q) =>
      q.includes("createTest") ? { createTest: { test: { issueId: "9", jira: { key: "P-9" } } } } : {};
    const plan = await planPush(t, "t1", null, deps);
    await runAll(plan.ops);
    expect(gqlCalls()[0].body.variables.steps[0].attachments[0].filename).toBe("images/");
  });
});
