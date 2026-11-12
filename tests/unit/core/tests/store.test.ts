import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { testHash } from "../../../../src/core/lib/hash.ts";
import * as store from "../../../../src/core/lib/store.ts";
import { newTest, serializeTest } from "../../../../src/core/lib/testfile.ts";

const FIXTURE = resolve(import.meta.dirname, "..", "..", "..", "fixtures", "project");
let P = "";

beforeEach(() => {
  P = mkdtempSync(join(tmpdir(), "testimus-store-"));
  cpSync(FIXTURE, P, { recursive: true });
});

test("listLocalTests reads review, sync, step count and findings of the fixture", () => {
  const list = store.listLocalTests(P);
  expect(list.map((t) => t.id)).toEqual(["LFRPS12-1398", "LFRPS12-1420", "local-3f9a12c0"]);
  expect(list[0]).toMatchObject({
    key: "LFRPS12-1398",
    summary: "Disjoncteur — ouverture à distance",
    folder: "/Traction/Disjoncteurs",
    review: "validated",
    sync: "synced",
    synced: true,
    dirty: false,
    stepCount: 1,
  });
  expect(list[0].findings).toBeUndefined();
  expect(list[0].mtime).toBeGreaterThan(0);
  expect(list[1]).toMatchObject({ review: "draft", sync: "modified", dirty: true, stepCount: 5 });
  const md = readFileSync(join(P, "tests/LFRPS12-1420/test.md"), "utf8");
  expect(list[1].findings).toEqual({
    errors: 2,
    warnings: 2,
    infos: 0,
    stale: testHash(md) !== "50013b5ee423d0a8",
  });
  expect(list[2]).toMatchObject({ key: undefined, review: "to-fix", sync: "local", synced: false, dirty: true });
});

test("a check.json is stale once the test body changes, not when only the frontmatter does", () => {
  const md = readFileSync(join(P, "tests/LFRPS12-1420/test.md"), "utf8");
  writeFileSync(
    join(P, "tests/LFRPS12-1420/check.json"),
    JSON.stringify({
      at: "x",
      testHash: testHash(md),
      findings: [{ kind: "other", severity: "info", message: "m", sources: [] }],
    }),
  );
  expect(store.localTestRef(P, "LFRPS12-1420")?.findings).toEqual({ errors: 0, warnings: 0, infos: 1, stale: false });
  writeFileSync(join(P, "tests/LFRPS12-1420/test.md"), md.replace("review: draft", "review: validated"));
  expect(store.localTestRef(P, "LFRPS12-1420")?.findings?.stale).toBe(false);
  writeFileSync(join(P, "tests/LFRPS12-1420/test.md"), md.replace("Choisir Propriétés.", "Choisir Fermer."));
  expect(store.localTestRef(P, "LFRPS12-1420")?.findings?.stale).toBe(true);
});

test("the remote-changed marker wins over modified, and a new snapshot clears it", () => {
  store.markRemoteChanged(P, "LFRPS12-1398", true);
  expect(store.isRemoteChanged(P, "LFRPS12-1398")).toBe(true);
  expect(store.localTestRef(P, "LFRPS12-1398")?.sync).toBe("remote-changed");
  store.writeRemote(P, "LFRPS12-1398", readFileSync(join(P, "tests/LFRPS12-1398/test.md"), "utf8"));
  expect(store.isRemoteChanged(P, "LFRPS12-1398")).toBe(false);
  expect(store.localTestRef(P, "LFRPS12-1398")?.sync).toBe("synced");
  store.markRemoteChanged(P, "LFRPS12-1398", false);
  expect(store.readRemote(P, "local-3f9a12c0")).toBeNull();
});

test("readTest returns both copies and writeTest makes the test modified", () => {
  const { test: t, md, remoteMd, warnings } = store.readTest(P, "LFRPS12-1398");
  expect(warnings).toEqual([]);
  expect(remoteMd).toBe(md);
  expect(serializeTest(t)).toBe(md);

  store.writeTest(P, "LFRPS12-1398", { ...t, summary: "Edited summary" });
  expect(store.localTestRef(P, "LFRPS12-1398")).toMatchObject({ summary: "Edited summary", sync: "modified" });
  store.writeTest(P, "LFRPS12-1398", t);
  expect(store.localTestRef(P, "LFRPS12-1398")?.sync).toBe("synced");
  expect(store.readTest(P, "local-3f9a12c0").remoteMd).toBeUndefined();
  expect(() => store.readTest(P, "LFRPS12-9999")).toThrow(/No test LFRPS12-9999/);
});

test("a generated test is edited once its content leaves what the generation wrote", () => {
  const { test: t } = store.readTest(P, "LFRPS12-1398");
  store.writeTest(P, "LFRPS12-1398", { ...t, generatedBy: "job-1" });
  expect(store.localTestRef(P, "LFRPS12-1398")).toMatchObject({ generated: true, edited: false });
  store.markGenerated(P, "LFRPS12-1398");
  store.writeTest(P, "LFRPS12-1398", {
    ...t,
    generatedBy: "job-1",
    review: "validated",
    key: "LFRPS12-7",
    folder: "/moved",
    labels: ["testimus-validated"],
  });
  expect(store.localTestRef(P, "LFRPS12-1398")?.edited).toBe(false);
  store.writeTest(P, "LFRPS12-1398", { ...t, generatedBy: "job-1", summary: "Edited by hand" });
  expect(store.localTestRef(P, "LFRPS12-1398")?.edited).toBe(true);
  store.writeTest(P, "LFRPS12-1398", { ...t, summary: "Edited by hand" });
  expect(store.localTestRef(P, "LFRPS12-1398")).toMatchObject({ generated: false, edited: false });
  store.writeTest(P, "LFRPS12-1398", t);
});

test("writeTest orders the fields by the order given", () => {
  const t = newTest("LFRPS12", "/");
  t.steps[0].fields = { Exigence: "E", "Expected Result": "r", Action: "a" };
  const md = store.writeTest(P, "local-00000001", t, ["Action", "Data", "Expected Result", "Exigence"]);
  expect(md.indexOf("### Action")).toBeLessThan(md.indexOf("### Expected Result"));
  expect(md.indexOf("### Expected Result")).toBeLessThan(md.indexOf("### Exigence"));
  expect(readFileSync(join(P, "tests/local-00000001/test.md"), "utf8")).toBe(md);
});

test("createLocalTest, cloneLocalTest and removeTest", async () => {
  expect(store.newLocalId()).toMatch(/^local-[0-9a-f]{8}$/);
  const id = store.createLocalTest(P, newTest("LFRPS12", "/Traction"));
  expect(id).toMatch(/^local-[0-9a-f]{8}$/);
  expect(store.readTest(P, id).test).toMatchObject({ project: "LFRPS12", folder: "/Traction", review: "draft" });

  const c = await store.cloneLocalTest(P, "LFRPS12-1420");
  const { test: t, remoteMd } = store.readTest(P, c);
  expect(remoteMd).toBeUndefined();
  expect(t).toMatchObject({
    key: undefined,
    status: undefined,
    clonedFrom: "LFRPS12-1420",
    summary: "Sectionneur sans TK — menu contextuel et propriétés (copy)",
    review: "draft",
    generatedBy: undefined,
  });
  expect(t.steps).toHaveLength(5);
  expect(t.steps.every((s) => s.id === undefined)).toBe(true);
  expect(t.steps[0].images).toEqual([{ file: "images/fig-40.png" }]);
  expect(t.steps[0].sources).toHaveLength(2);
  expect(t.steps[1].fields.Exigence).toBe("EXI_MOP_SPF_511_A_1670, EXI_MOP_SPF_510_A_20");
  expect(existsSync(join(P, "tests", c, "images/fig-40.png"))).toBe(true);
  expect(existsSync(join(P, "tests", c, "check.json"))).toBe(false);

  const r = await store.cloneLocalTest(P, "local-3f9a12c0");
  expect(store.readTest(P, r).test).toMatchObject({ clonedFrom: undefined, reviewNote: undefined });

  store.removeTest(P, c);
  expect(existsSync(join(P, "tests", c))).toBe(false);
  expect(store.listLocalTests(P)).toHaveLength(5);
});

test("images and the local-to-key rename", () => {
  const id = store.createLocalTest(P, newTest("LFRPS12", "/"));
  const img = store.addImage(P, id, new Uint8Array([1, 2, 3, 4]), ".PNG");
  expect(img.file).toMatch(/^images\/img-[0-9a-f]{8}\.png$/);
  expect(readFileSync(join(P, "tests", id, img.file))).toEqual(Buffer.from([1, 2, 3, 4]));

  store.renameTestFolder(P, id, "LFRPS12-77");
  expect(existsSync(join(P, "tests", id))).toBe(false);
  expect(existsSync(join(P, "tests/LFRPS12-77", img.file))).toBe(true);
  expect(() => store.renameTestFolder(P, "LFRPS12-77", "LFRPS12-1398")).toThrow(/already exists/);

  store.removeImageFile(P, "LFRPS12-77", img.file);
  expect(existsSync(join(P, "tests/LFRPS12-77", img.file))).toBe(false);
  store.removeImageFile(P, "LFRPS12-77", "images/gone.png");
  expect(() => store.removeImageFile(P, "LFRPS12-77", "../test.md")).toThrow(/not a test image/);
});

test("a test id never leaves the tests folder; an empty project lists nothing", () => {
  for (const bad of ["..", "../x", "a/b", "a\\b", "", ".hidden"])
    expect(() => store.testDir(P, bad)).toThrow(/not a test id/);
  const empty = mkdtempSync(join(tmpdir(), "testimus-empty-"));
  expect(store.listLocalTests(empty)).toEqual([]);
  mkdirSync(join(empty, "tests/half-written"), { recursive: true });
  expect(store.listLocalTests(empty)).toEqual([]);
});
