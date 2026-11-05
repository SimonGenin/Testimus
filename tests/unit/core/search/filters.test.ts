import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseQuery, typing } from "../../../../src/core/search/query.ts";
import { keepTest, type TestDoc, testsCorpus } from "../../../../src/core/search/tests.ts";
import type { Step, Test } from "../../../../src/core/types.ts";

describe("a filter with a value it does not know is reported, not searched", () => {
  it("an unknown kind, sync, has or is is left out and reported; a key with no value yet is nothing", () => {
    const q = parseQuery("in:nothing sync:zz has:colour is:odd review: label: http:x");
    expect(q.filters).toEqual({});
    expect(q.terms).toEqual(["http:x"]);
    expect(q.used.map((u) => [u.token, u.known])).toEqual([
      ["in:nothing", false],
      ["sync:zz", false],
      ["has:colour", false],
      ["is:odd", false],
    ]);
  });

  it("each filter read keeps its token as typed and the value it keeps", () => {
    expect(parseQuery('Review:Fix -folder:"Mes tests" tag:x').used).toEqual([
      { token: "Review:Fix", key: "review", value: "to-fix", known: true },
      { token: '-folder:"Mes tests"', key: "folder", value: "/Mes tests", known: true },
      { token: "tag:x", key: "label", value: "x", known: true },
    ]);
  });

  it("typing: the filter at the end of the query, before its space", () => {
    expect(typing("menu label:")).toEqual({ token: "label:", key: "label", value: "" });
    expect(typing("review:to")).toEqual({ token: "review:to", key: "review", value: "to" });
    expect(typing('dir:"Trac')).toEqual({ token: 'dir:"Trac', key: "folder", value: "Trac" });
    expect(typing("label:x ")).toBeNull();
    expect(typing("http:x")).toBeNull();
    expect(typing("menu")).toBeNull();
  });

  it("an empty phrase is dropped, a quoted filter value is a filter, an excluded phrase is excluded", () => {
    const q = parseQuery('"" label:"Lot 2" -"mode dégradé" tag:urgent dir:Traction/Sect');
    expect(q.phrases).toEqual([]);
    expect(q.exclude).toEqual(["mode dégradé"]);
    expect(q.filters).toEqual({ label: ["lot 2", "urgent"], folder: ["/traction/sect"] });
    expect(q.text).toBe("");
  });
});

const step = (o: { sources?: number; images?: number } = {}): Step => ({
  fields: { Action: "a" },
  sources: Array.from({ length: o.sources ?? 0 }, () => ({ docId: "D", anchor: "§1", quote: "q" })),
  images: Array.from({ length: o.images ?? 0 }, () => ({ file: "fig.png" })),
});

const doc = (t: Partial<Test>, o: Partial<TestDoc> = {}): TestDoc =>
  ({
    id: "T",
    fields: [],
    sync: "local",
    dirty: false,
    mtime: 0,
    test: { review: "draft", labels: [], folder: "/", steps: [step()], ...t },
    ...o,
  }) as unknown as TestDoc;

const keep = (raw: string, d: TestDoc) => keepTest(d, parseQuery(raw).filters);

describe("which tests a filter keeps", () => {
  it("sync: keeps the tests in that state", () => {
    expect(keep("sync:modified", doc({}, { sync: "modified" }))).toBe(true);
    expect(keep("sync:modified", doc({}, { sync: "synced" }))).toBe(false);
  });

  it("label: keeps a test that has every label asked, in part and in any case", () => {
    const d = doc({ labels: ["Sprint-3", "Traction"] });
    expect(keep("label:sprint label:tract", d)).toBe(true);
    expect(keep("label:sprint label:signal", d)).toBe(false);
  });

  it("has: findings, sources, key, images and a review note", () => {
    const bare = doc({});
    for (const h of ["findings", "sources", "key", "images", "note"]) expect(keep(`has:${h}`, bare), h).toBe(false);
    expect(keep("has:findings", doc({}, { findings: { errors: 0, warnings: 0, infos: 0, stale: false } }))).toBe(false);
    expect(keep("has:findings", doc({}, { findings: { errors: 0, warnings: 1, infos: 0, stale: false } }))).toBe(true);
    expect(keep("has:sources", doc({ steps: [step(), step({ sources: 1 })] }))).toBe(true);
    expect(keep("has:key", doc({ key: "LFRPS12-1" }))).toBe(true);
    expect(keep("has:images", doc({ steps: [step({ images: 2 })] }))).toBe(true);
    expect(keep("has:note", doc({ reviewNote: "Step 2 is wrong" }))).toBe(true);
  });

  it("is: generated, awaiting review, and changed since Jira", () => {
    const made = doc({ generatedBy: "opus", review: "draft" });
    expect(keep("is:generated", doc({}))).toBe(false);
    expect(keep("is:generated", made)).toBe(true);
    expect(keep("is:awaiting", made)).toBe(true);
    expect(keep("is:awaiting", doc({ generatedBy: made.test.generatedBy, review: "validated" }))).toBe(false);
    expect(keep("is:dirty", doc({}))).toBe(false);
    expect(keep("is:dirty", doc({}, { dirty: true }))).toBe(true);
  });
});

describe("the tests corpus of a project", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("is empty without a tests folder, and skips a test folder that has no test.md", () => {
    dir = mkdtempSync(join(tmpdir(), "testimus-corpus-"));
    writeFileSync(join(dir, "project.json"), "{}");
    expect(testsCorpus(dir).docs).toEqual([]);
    mkdirSync(join(dir, "tests", "T-1"), { recursive: true });
    writeFileSync(join(dir, "tests", "T-1", "notes.txt"), "not a test");
    expect(testsCorpus(dir).docs).toEqual([]);
  });
});
