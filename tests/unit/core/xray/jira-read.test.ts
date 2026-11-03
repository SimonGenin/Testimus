import { describe, expect, it } from "vitest";
import { env } from "../../../../src/core/env.ts";
import { reviewOfLabels } from "../../../../src/core/lib/jira/labels.ts";
import {
  getFolderTree,
  getProjectInfo,
  getStepFields,
  listPreconditions,
  listTests,
  pullTest,
  searchTests,
} from "../../../../src/core/lib/jira/read.ts";
import { mimeOf } from "../../../../src/core/lib/jira/steps.ts";

import { fake, fakeXray, gqlCalls, JIRA, ok, status, writeCreds, XRAY } from "./fake-xray.ts";

fakeXray();

describe("read paths, sparse answers", () => {
  it("getProjectInfo falls back to the Test type and to the key as name", async () => {
    fake.route = (req) =>
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
    fake.route = (req) => (req.url.includes("/project/") ? ok({ id: 5, key: "P" }) : undefined);
    await expect(getProjectInfo("P")).rejects.toThrow('Project P has no "Xray Test" or "Test" issue type.');
  });

  it("getStepFields without settings gives the built-in three, typed text", async () => {
    fake.graph = () => ({ getProjectSettings: null });
    expect((await getStepFields("1")).map((f) => [f.id, f.type])).toEqual([
      ["action", "text"],
      ["data", "text"],
      ["result", "text"],
    ]);
    fake.graph = () => ({ getProjectSettings: {} });
    expect(await getStepFields("1")).toHaveLength(3);
    fake.graph = () => ({
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
    fake.graph = () => ({ getFolder: {} });
    expect(await getFolderTree("1")).toEqual({ name: "/", path: "/", testsCount: 0, totalCount: 0, folders: [] });
    fake.graph = () => ({ getFolder: null });
    await expect(getFolderTree("1", "/Nope")).rejects.toThrow("Xray folder /Nope does not exist");
  });

  it("listTests reads a bare result, and asks the root folder without descendants by default", async () => {
    fake.graph = () => ({ getTests: { results: [{ issueId: 3 }] } });
    expect(await listTests("1", { folder: "" })).toEqual({
      tests: [{ key: "", issueId: "3", summary: "", status: "", labels: [], folder: "", stepCount: 0 }],
      total: 0,
    });
    expect(gqlCalls()[0].body.variables.folder).toEqual({ path: "/", includeDescendants: false });
    fake.graph = () => ({ getTests: {} });
    expect(await listTests("1", { jql: "x" })).toEqual({ tests: [], total: 0 });
  });

  it("listPreconditions pages past the first hundred and sorts by key", async () => {
    fake.graph = (_q, v) =>
      v.start === 0
        ? { getPreconditions: { total: 150, results: [{ issueId: 2, jira: { key: "P-2" } }] } }
        : v.start === 100
          ? { getPreconditions: { total: 150, results: [{ issueId: 1, jira: { key: "P-1", summary: "s" } }] } }
          : { getPreconditions: {} };
    const list = await listPreconditions("1");
    expect(list.map((p) => p.key)).toEqual(["P-1", "P-2"]);
    expect(list[1]).toEqual({ key: "P-2", issueId: "2", summary: "", definition: "" });
    expect(gqlCalls()).toHaveLength(2);
    fake.graph = () => ({ getPreconditions: {} });
    expect(await listPreconditions("1")).toEqual([]);
  });

  it("searchTests escapes backslashes and keeps bare digits as text without a project key", async () => {
    fake.graph = () => ({ getTests: { total: 0, results: [] } });
    await searchTests("1", ' a\\b"c ');
    expect(gqlCalls()[0].body.variables.jql).toContain('summary ~ "a\\\\b\\"c"');
    await searchTests("1", "42");
    expect(gqlCalls()[1].body.variables.jql).toMatch(/AND summary ~ "42"$/);
  });
});

describe("pullTest, sparse and odd answers", () => {
  it("refuses a key that is not a test", async () => {
    fake.graph = () => ({ getTests: {} });
    await expect(pullTest("P-1")).rejects.toThrow("P-1 is not an Xray test");
  });

  it("reads a bare test: no steps, no fields, no links", async () => {
    fake.graph = () => ({ getTests: { results: [{ issueId: 8 }] } });
    fake.route = (req) => (req.url.includes("/issue/") ? status(200, "") : undefined);
    const p = await pullTest("P-1");
    expect(p.issueId).toBe("8");
    expect(p.test).toMatchObject({ key: "P-1", project: "P", summary: "", folder: "", labels: [], covers: [] });
    expect(p.test.status).toBeUndefined();
    expect(p.test.clonedFrom).toBeUndefined();
  });

  it("reads custom values of every kind, attachments without names, and skips links without an outward issue", async () => {
    fake.graph = () => ({
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
    fake.route = (req) =>
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
    fake.graph = () => ({
      getTests: {
        results: [
          { issueId: 1, steps: [{ id: "s", attachments: [{ id: "a", filename: "f.png", downloadLink: link }] }] },
        ],
      },
    });
    fake.route = (req) => (req.url.includes("/issue/") ? ok({ fields: {} }) : undefined);
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

describe("pullTest, nameless pieces", () => {
  it("names a nameless attachment image.png and reads a precondition without Jira fields", async () => {
    fake.graph = () => ({
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
    fake.route = (req) => (req.url.includes("/issue/") ? ok({ fields: {} }) : undefined);
    const p = await pullTest("P-1");
    expect(p.images[0].filename).toBe("image.png");
    expect(p.preconditions).toEqual([
      { key: "", issueId: "4", summary: "", definition: "def" },
      { key: "", issueId: "3", summary: "", definition: "" },
    ]);
  });
});
