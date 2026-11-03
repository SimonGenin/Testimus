import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../src/core/command.ts";
import { commands as contexts } from "../../src/core/commands/contexts.ts";
import { commands as tests } from "../../src/core/commands/tests.ts";
import { commands as xray } from "../../src/core/commands/xray.ts";
import { env } from "../../src/core/env.ts";
import { setModes } from "../../src/core/lib/columns.ts";
import { resetAuth } from "../../src/core/lib/jira.ts";
import { readTest, writeTest } from "../../src/core/lib/store.ts";
import { mockHttp, resetMockJira } from "../../src/core/mock/jira.ts";

const FIXTURE = resolve(import.meta.dirname, "../fixtures/project");
const all = [...tests, ...xray, ...contexts];
const http = env.http;
let P = "";

const run = async (name: string, input: unknown = {}): Promise<any> => {
  const c = all.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return c.run(quietCtx(P), c.input.parse(input) as never);
};

afterAll(() => {
  env.http = http;
});

beforeEach(() => {
  P = join(mkdtempSync(join(tmpdir(), "testimus-parity-")), "LFRPS12");
  cpSync(FIXTURE, P, { recursive: true });
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

describe("tests.restore (Undo local changes)", () => {
  it("rewrites test.md from .remote.md, every header field and step included", async () => {
    const { test } = readTest(P, "LFRPS12-1420");
    test.summary = "Changed here";
    test.steps.pop();
    writeTest(P, "LFRPS12-1420", test);
    expect((await run("tests.show", { id: "LFRPS12-1420" })).sync).toBe("modified");
    const ref = await run("tests.restore", { id: "LFRPS12-1420" });
    expect(ref.sync).toBe("synced");
    const after = await run("tests.show", { id: "LFRPS12-1420" });
    expect(after.test).toEqual(after.remote);
    expect(after.test.steps.length).toBeGreaterThan(test.steps.length);
  });

  it("refuses a test that was never synced", async () => {
    await expect(run("tests.restore", { id: "local-3f9a12c0" })).rejects.toThrow("never synced");
  });
});

describe("tests.show extras", () => {
  it("lists the picture files and the mtime of test.md", async () => {
    const r = await run("tests.show", { id: "LFRPS12-1420" });
    expect(r.files.every((f: string) => f.startsWith("images/"))).toBe(true);
    expect(r.files.length).toBeGreaterThan(0);
    expect(r.mtime).toBeGreaterThan(0);
  });
});

describe("tests.columns / tests.setColumns", () => {
  it("layers the test's own modes over the project's and never touches test.md", async () => {
    const md = readFileSync(join(P, "tests/LFRPS12-1420/test.md"), "utf8");
    expect(await run("tests.columns", { id: "LFRPS12-1420" })).toEqual({ own: null, project: { Data: "filled" } });
    const set = await run("tests.setColumns", { id: "LFRPS12-1420", modes: { Data: "open", Exigence: "collapsed" } });
    expect(set.own).toEqual({ Data: "open", Exigence: "collapsed" });
    expect(JSON.parse(readFileSync(join(P, "tests/LFRPS12-1420/local.json"), "utf8"))).toEqual({
      columns: { Data: "open", Exigence: "collapsed" },
    });
    expect(readFileSync(join(P, "tests/LFRPS12-1420/test.md"), "utf8")).toBe(md);
    expect((await run("tests.show", { id: "LFRPS12-1420" })).md).toBe(md);
    expect((await run("tests.setColumns", { id: "LFRPS12-1420", modes: null })).own).toBeNull();
    expect(existsSync(join(P, "tests/LFRPS12-1420/local.json"))).toBe(false);
  });

  it("columns.setModes saves the project's « when filled » columns", async () => {
    const r = setModes(P, { Data: "filled", Exigence: "filled" });
    expect(r.filter((c) => c.mode === "filled").map((c) => c.name)).toEqual(["Data", "Exigence"]);
    expect((await run("tests.columns", { id: "LFRPS12-1420" })).project).toEqual({
      Data: "filled",
      Exigence: "filled",
    });
  });
});

describe("tests.removeImage", () => {
  it("deletes only a picture no step lists any more", async () => {
    const { test } = readTest(P, "LFRPS12-1420");
    const file = test.steps.flatMap((s) => s.images)[0].file;
    expect(await run("tests.removeImage", { id: "LFRPS12-1420", file })).toMatchObject({ removed: false });
    expect(existsSync(join(P, "tests/LFRPS12-1420", file))).toBe(true);
    for (const s of test.steps) s.images = s.images.filter((im) => im.file !== file);
    writeTest(P, "LFRPS12-1420", test);
    expect(await run("tests.removeImage", { id: "LFRPS12-1420", file })).toEqual({ removed: true });
    expect(existsSync(join(P, "tests/LFRPS12-1420", file))).toBe(false);
    await expect(run("tests.removeImage", { id: "LFRPS12-1420", file: "../test.md" })).rejects.toThrow();
  });
});

describe("preconditions", () => {
  it("xray.preconditions lists the project's, sorted, with their definitions", async () => {
    const list = await run("xray.preconditions");
    expect(list.map((p: { key: string }) => p.key)).toEqual(["LFRPS12-77", "LFRPS12-78"]);
    expect(list[0].definition).toContain("R³");
  });

  it("tests.edit attaches and detaches them as a sorted set", async () => {
    await run("tests.edit", { id: "local-3f9a12c0", preconditions: ["lfrps12-78", "LFRPS12-77", "LFRPS12-78"] });
    expect(readTest(P, "local-3f9a12c0").test.preconditions).toEqual(["LFRPS12-77", "LFRPS12-78"]);
    await run("tests.edit", { id: "local-3f9a12c0", preconditions: [] });
    expect(readTest(P, "local-3f9a12c0").test.preconditions).toEqual([]);
  });
});

describe("xray.browse", () => {
  it("names the issue page of the site, without /wiki", async () => {
    expect(await run("xray.browse", { key: "lfrps12-1420" })).toEqual({
      url: "https://mock.atlassian.net/browse/LFRPS12-1420",
    });
    await expect(run("xray.browse", { key: "not a key" })).rejects.toThrow("not an issue key");
  });
});

describe("contexts", () => {
  it("creates, edits, attaches files, and resolves a test's own list over the project's", async () => {
    const c = await run("contexts.create", { name: "Glossaire RATP" });
    expect(c.id).toMatch(/^ctx-[0-9a-f]{8}$/);
    const set = await run("contexts.set", { id: c.id, notes: "PCC = poste de commande", paths: [P] });
    expect(set).toMatchObject({ name: "Glossaire RATP", notes: "PCC = poste de commande", paths: [P], hasNotes: true });
    expect(((await run("contexts.set", { id: c.id, paths: [P, "docs"] })) as { paths: string[] }).paths).toEqual([
      P,
      "docs",
    ]);
    await run("contexts.set", { id: c.id, paths: [P] });
    const up = await run("contexts.addFile", {
      id: c.id,
      name: "lexique.txt",
      dataBase64: Buffer.from("x").toString("base64"),
    });
    expect(up.added).toBe("lexique.txt");
    const again = await run("contexts.addFile", { id: c.id, name: "lexique.txt", dataBase64: "eA==" });
    expect(again.added).toBe("lexique (2).txt");
    expect((await run("contexts.removeFile", { id: c.id, name: "lexique.txt" })).files).toEqual(["lexique (2).txt"]);
    expect((await run("contexts.list")).map((x: { id: string }) => x.id)).toEqual([c.id]);

    expect(await run("contexts.ofTest", { testId: "LFRPS12-1420" })).toEqual({ effective: [], own: null, project: [] });
    expect(await run("contexts.setTest", { testId: "LFRPS12-1420", contexts: [c.id, "ctx-gone"] })).toEqual({
      effective: [c.id],
      own: [c.id, "ctx-gone"],
    });
    expect((await run("contexts.setTest", { testId: "LFRPS12-1420", contexts: null })).own).toBeNull();
    await run("contexts.remove", { id: c.id });
    expect(await run("contexts.list")).toEqual([]);
  });

  it("every input field is described", () => {
    for (const c of contexts) {
      const shape = (c.input as any).shape as Record<string, { description?: string }>;
      for (const [k, v] of Object.entries(shape)) expect(v.description, `${c.name} ${k}`).toBeTruthy();
    }
  });
});
