import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPrompt,
  effectiveContexts,
  readContextFile,
  readContexts,
  sharedContexts,
} from "../../src/core/claude/prompt.ts";
import { contextDirs } from "../../src/core/claude/run.ts";
import { quietCtx } from "../../src/core/command.ts";
import { commands as contexts } from "../../src/core/commands/contexts.ts";
import { commands as project } from "../../src/core/commands/project.ts";
import { credsDir, credsStatus, savedSecrets } from "../../src/core/lib/creds.ts";
import { writeContextMd } from "./context-helpers.ts";

const FIXTURE = resolve(import.meta.dirname, "../fixtures/project");
const all = [...contexts, ...project];
let P = "";

beforeEach(() => {
  P = mkdtempSync(join(tmpdir(), "testimus-ctx-"));
  cpSync(FIXTURE, P, { recursive: true });
});
afterEach(() => rmSync(sharedContexts(), { recursive: true, force: true }));

const run = async <T>(name: string, input: unknown = {}): Promise<T> => {
  const c = all.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return (await c.run(quietCtx(P), c.input.parse(input) as never)) as T;
};

type Detail = { id: string; name: string; paths: string[]; files: string[]; hasNotes: boolean; notes: string };

describe("contexts commands", () => {
  it("describe every input field", () => {
    for (const c of all.filter((x) => x.name.startsWith("contexts.") || x.name.startsWith("project.notes"))) {
      const shape = (c.input as unknown as { shape: Record<string, { description?: string }> }).shape;
      for (const [k, v] of Object.entries(shape)) expect(v.description, `${c.name} ${k}`).toBeTruthy();
    }
  });

  it("create, list, show and set a context", async () => {
    expect(await run("contexts.list")).toEqual([]);
    const c = await run<Detail>("contexts.create", { name: "House style" });
    expect(c.id).toMatch(/^ctx-[0-9a-f]{8}$/);
    expect(c).toMatchObject({ name: "House style", paths: [], files: [], hasNotes: false, notes: "" });
    const blank = await run<Detail>("contexts.create", {});
    expect(blank.name).toBe("New context");
    const outside = mkdtempSync(join(tmpdir(), "testimus-outside-"));
    const set = await run<Detail>("contexts.set", {
      id: c.id,
      name: "  Style maison ",
      notes: "Une action par pas.",
      paths: [outside, ` ${outside} `],
    });
    expect(set).toMatchObject({ name: "Style maison", notes: "Une action par pas.", hasNotes: true, paths: [outside] });
    expect(readContextFile(join(P, "contexts", c.id))).toEqual({
      name: "Style maison",
      paths: [outside],
      notes: "Une action par pas.",
    });
    expect(readFileSync(join(P, "contexts", c.id, "context.md"), "utf8")).toMatch(
      /^---\nname: Style maison\npaths:\n {2}- /,
    );
    const list = await run<Detail[]>("contexts.list");
    expect(list.map((x) => x.name)).toEqual(["New context", "Style maison"]);
    expect(await run<Detail>("contexts.show", { id: c.id })).toMatchObject({ notes: "Une action par pas." });
    expect((await run<Detail>("contexts.set", { id: c.id, paths: ["relative\\dir"] })).paths).toEqual([
      "relative\\dir",
    ]);
    await expect(run("contexts.show", { id: "ctx-missing" })).rejects.toThrow(/No context ctx-missing/);
    await expect(run("contexts.set", { id: "ctx-missing", name: "x" })).rejects.toThrow(/No context/);
    expect(() => all.find((x) => x.name === "contexts.show")?.input.parse({ id: "../x" })).toThrow();
  });

  it("copies files in, by upload or by path, without overwriting, and removes them", async () => {
    const c = await run<Detail>("contexts.create", {});
    const up = await run<Detail & { added: string }>("contexts.addFile", {
      id: c.id,
      name: "glossaire.txt",
      dataBase64: Buffer.from("PCC = poste de commande").toString("base64"),
    });
    expect(up.added).toBe("glossaire.txt");
    const again = await run<Detail & { added: string }>("contexts.addFile", {
      id: c.id,
      name: "dir/glossaire.txt",
      dataBase64: `data:text/plain;base64,${Buffer.from("v2").toString("base64")}`,
    });
    expect(again.added).toBe("glossaire (2).txt");
    expect(readFileSync(join(P, "contexts", c.id, "files", "glossaire (2).txt"), "utf8")).toBe("v2");
    const src = join(mkdtempSync(join(tmpdir(), "testimus-src-")), "plan.pdf");
    writeFileSync(src, "pdf");
    const byPath = await run<Detail & { added: string }>("contexts.addFile", { id: c.id, file: src });
    expect(byPath.added).toBe("plan.pdf");
    expect(byPath.files.sort()).toEqual(["glossaire (2).txt", "glossaire.txt", "plan.pdf"]);
    await expect(run("contexts.addFile", { id: c.id, file: "D:\\nowhere\\x.pdf" })).rejects.toThrow(/No file/);
    await expect(run("contexts.addFile", { id: c.id })).rejects.toThrow(/Give a file or an upload/);
    const less = await run<Detail>("contexts.removeFile", { id: c.id, name: "plan.pdf" });
    expect(less.files).not.toContain("plan.pdf");
    await expect(run("contexts.removeFile", { id: c.id, name: "../project.json" })).rejects.toThrow(/not a file/);
    expect(existsSync(join(P, "project.json"))).toBe(true);
  });

  it("removes a context folder", async () => {
    const c = await run<Detail>("contexts.create", {});
    expect(await run("contexts.remove", { id: c.id })).toEqual({ id: c.id, removed: true });
    expect(existsSync(join(P, "contexts", c.id))).toBe(false);
    await expect(run("contexts.remove", { id: c.id })).rejects.toThrow(/No context/);
  });

  it("a shared context is seen by every project, edited in place, attached to runs and moved back", async () => {
    const other = mkdtempSync(join(tmpdir(), "testimus-ctx-shared-"));
    cpSync(FIXTURE, other, { recursive: true });
    const own = await run<Detail & { shared: boolean }>("contexts.create", { name: "Mine" });
    expect(own.shared).toBe(false);
    const lib = await run<Detail & { shared: boolean }>("contexts.create", { name: "Glossaire", shared: true });
    expect(lib.shared).toBe(true);
    expect(existsSync(join(sharedContexts(), lib.id, "context.md"))).toBe(true);
    expect(existsSync(join(P, "contexts", lib.id))).toBe(false);
    await run("contexts.set", { id: lib.id, notes: "PCC = poste de commande" });
    const seen = (await (all.find((x) => x.name === "contexts.list")?.run(quietCtx(other), {}) as Promise<
      (Detail & { shared: boolean })[]
    >)) as (Detail & { shared: boolean })[];
    expect(seen.map((c) => [c.name, c.shared])).toEqual([["Glossaire", true]]);
    expect((await run<Detail[]>("contexts.list", { from: other })).length).toBe(0);
    writeFileSync(
      join(other, "project.json"),
      JSON.stringify({
        ...JSON.parse(readFileSync(join(other, "project.json"), "utf8")),
        claude: { contexts: [lib.id] },
      }),
    );
    expect(effectiveContexts(other)).toContain(lib.id);
    expect(buildPrompt({ kind: "project" }, "", readContexts(other, [lib.id]), other)).toContain(
      `${sharedContexts().replace(/\\/g, "/")}/${lib.id}/context.md`,
    );
    expect(contextDirs(other, [lib.id])).toEqual([join(sharedContexts(), lib.id)]);
    const moved = await run<Detail & { shared: boolean }>("contexts.share", { id: lib.id, shared: false });
    expect(moved).toMatchObject({ shared: false, notes: "PCC = poste de commande" });
    expect(existsSync(join(P, "contexts", lib.id, "context.md"))).toBe(true);
    expect(existsSync(join(sharedContexts(), lib.id))).toBe(false);
    expect(effectiveContexts(other)).not.toContain(lib.id);
    const back = await run<Detail & { shared: boolean }>("contexts.share", { id: own.id, shared: true });
    expect(back.shared).toBe(true);
    expect((await run<Detail & { shared: boolean }>("contexts.share", { id: own.id, shared: true })).shared).toBe(true);
    await run("contexts.remove", { id: own.id });
    expect(existsSync(join(sharedContexts(), own.id))).toBe(false);
  });

  it("lists another project's contexts and copies one over, renaming a taken id", async () => {
    const other = mkdtempSync(join(tmpdir(), "testimus-ctx-other-"));
    cpSync(FIXTURE, other, { recursive: true });
    const theirs = (await (all
      .find((x) => x.name === "contexts.create")
      ?.run(quietCtx(other), {
        name: "Glossaire",
      }) as Promise<Detail>)) as Detail;
    writeFileSync(join(other, "contexts", theirs.id, "files", "g.txt"), "PCC");
    writeContextMd(join(other, "contexts", theirs.id), { name: "Glossaire", notes: "Notes" });
    expect((await run<Detail[]>("contexts.list", { from: other })).map((c) => c.name)).toEqual(["Glossaire"]);
    const copy = await run<Detail>("contexts.copy", { from: other, id: theirs.id });
    expect(copy).toMatchObject({ id: theirs.id, name: "Glossaire", files: ["g.txt"], notes: "Notes" });
    const second = await run<Detail>("contexts.copy", { from: other, id: theirs.id });
    expect(second.id).not.toBe(theirs.id);
    expect(second.id).toMatch(/^ctx-[0-9a-f]{8}$/);
    expect((await run<Detail[]>("contexts.list")).length).toBe(2);
    await expect(run("contexts.copy", { from: P, id: theirs.id })).rejects.toThrow(/That is this project/);
    await expect(run("contexts.list", { from: tmpdir() })).rejects.toThrow(/not a project folder/);
    await expect(run("contexts.copy", { from: other, id: "ctx-missing" })).rejects.toThrow(/No context/);
  });

  it("a test follows the project's defaults until it has its own list", async () => {
    const a = await run<Detail>("contexts.create", { name: "A" });
    const b = await run<Detail>("contexts.create", { name: "B" });
    await run("project.set", { claude: { contexts: [a.id, "ctx-gone"] } });
    const t = "LFRPS12-1398";
    expect(await run("contexts.ofTest", { testId: t })).toEqual({
      effective: [a.id],
      own: null,
      project: [a.id, "ctx-gone"],
    });
    expect(await run("contexts.setTest", { testId: t, contexts: [b.id] })).toEqual({ effective: [b.id], own: [b.id] });
    expect(await run("contexts.setTest", { testId: t, contexts: [] })).toEqual({ effective: [], own: [] });
    expect(await run("contexts.setTest", { testId: t, contexts: null })).toEqual({ effective: [a.id], own: null });
    await expect(run("contexts.ofTest", { testId: "NOPE-1" })).rejects.toThrow(/No test NOPE-1/);
    await run("contexts.setTest", { testId: "LFRPS12-1420", contexts: [b.id, a.id] });
    expect(await run("contexts.ofProject")).toEqual({ effective: [a.id, b.id] });
  });
});

describe("project notes", () => {
  it("reads and writes the project's CLAUDE.md", async () => {
    const file = join(P, "CLAUDE.md");
    rmSync(file, { force: true });
    expect(await run("project.notes")).toEqual({ file, text: "" });
    expect(await run("project.setNotes", { text: "# Notes\n\nPCC = poste de commande centralisé\n" })).toEqual({
      file,
      bytes: Buffer.byteLength("# Notes\n\nPCC = poste de commande centralisé\n"),
    });
    expect(readFileSync(file, "utf8")).toBe("# Notes\n\nPCC = poste de commande centralisé\n");
    expect(await run("project.notes")).toMatchObject({ text: "# Notes\n\nPCC = poste de commande centralisé\n" });
    await run("project.setNotes", { text: "" });
    expect(readFileSync(file, "utf8")).toBe("");
  });

  it("needs an open project", async () => {
    const c = all.find((x) => x.name === "project.notes");
    await expect(c?.run(quietCtx(null), {} as never) ?? Promise.resolve()).rejects.toThrow(/No project is open/);
  });
});

describe("credential files", () => {
  afterEach(() => rmSync(credsDir(), { recursive: true, force: true }));
  const put = (name: string, text: string) => {
    mkdirSync(credsDir(), { recursive: true });
    writeFileSync(join(credsDir(), name), text);
  };

  it("says missing, invalid (broken JSON or a missing field) or complete for both files", () => {
    rmSync(credsDir(), { recursive: true, force: true });
    expect(credsStatus().jira).toMatchObject({ exists: false, complete: false, invalid: false });
    expect(credsStatus().xray).toMatchObject({ exists: false, complete: false, invalid: false });
    put("credentials.json", "{ not json");
    put("xray_credentials.json", JSON.stringify({ clientId: "id" }));
    expect(credsStatus().jira).toMatchObject({
      exists: true,
      complete: false,
      invalid: true,
      problem: "not valid JSON",
    });
    expect(credsStatus().xray).toMatchObject({
      exists: true,
      complete: false,
      invalid: true,
      problem: "missing clientSecret",
    });
    put("credentials.json", JSON.stringify({ baseUrl: "https://a.atlassian.net/wiki", email: "me@a" }));
    expect(credsStatus().jira).toMatchObject({ invalid: true, problem: "missing token", email: "me@a" });
    put("credentials.json", "[1]");
    expect(credsStatus().jira).toMatchObject({ invalid: true, problem: "not a JSON object" });
    put("credentials.json", `\uFEFF${JSON.stringify({ baseUrl: "https://a.atlassian.net", email: "e", token: "t" })}`);
    put("xray_credentials.json", JSON.stringify({ clientId: "id", clientSecret: "s" }));
    const s = credsStatus();
    expect(s.jira).toMatchObject({ exists: true, complete: true, invalid: false });
    expect(s.jira.problem).toBeUndefined();
    expect(s.xray).toMatchObject({ exists: true, complete: true, invalid: false });
  });

  it("gives the saved secrets back for the form, empty when a file is missing or broken", async () => {
    rmSync(credsDir(), { recursive: true, force: true });
    expect(savedSecrets()).toEqual({ token: "", clientId: "", clientSecret: "" });
    put("credentials.json", JSON.stringify({ baseUrl: "https://a.atlassian.net", email: "e", token: " tok " }));
    put("xray_credentials.json", "{ broken");
    expect(savedSecrets()).toEqual({ token: "tok", clientId: "", clientSecret: "" });
    put("xray_credentials.json", JSON.stringify({ clientId: "id", clientSecret: "sec" }));
    const { commands: system } = await import("../../src/core/commands/system.ts");
    const c = system.find((x) => x.name === "system.secrets");
    expect(await c?.run(quietCtx(P), {} as never)).toEqual({ token: "tok", clientId: "id", clientSecret: "sec" });
    const { mcpAccess } = await import("../../src/core/claude/run.ts");
    expect((await mcpAccess("run")).deny).toContain("mcp__testimus__system_secrets");
  });
});
