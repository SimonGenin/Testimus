import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sharedContexts } from "../../../../src/core/claude/prompt.ts";
import { call, fixtureCopy } from "../registry.ts";

type Detail = {
  id: string;
  name: string;
  paths: string[];
  files: string[];
  hasNotes: boolean;
  shared: boolean;
  notes: string;
};

let P = "";
beforeEach(() => {
  P = fixtureCopy("ctx-reg");
});
afterEach(() => rmSync(sharedContexts(), { recursive: true, force: true }));

describe("contexts.* through the registry", () => {
  it("refuses every contexts command without an open project", async () => {
    await expect(call("contexts.list", {}, null)).rejects.toThrow(/No project is open/);
    await expect(call("contexts.create", {}, null)).rejects.toThrow(/No project is open/);
  });

  it("refuses an id that is not a folder name, with the command's help", async () => {
    await expect(call("contexts.show", { id: "../x" }, P)).rejects.toThrow(/Invalid input for contexts.show/);
  });

  it("contexts.create keeps a context in the project by default, in the shared library with shared", async () => {
    const own = await call<Detail>("contexts.create", { name: "  House style " }, P);
    expect(own).toMatchObject({ name: "House style", shared: false, paths: [], files: [], hasNotes: false, notes: "" });
    expect(own.id).toMatch(/^ctx-[0-9a-f]{8}$/);
    expect(existsSync(join(P, "contexts", own.id, "context.json"))).toBe(true);
    const lib = await call<Detail>("contexts.create", { shared: true }, P);
    expect(lib).toMatchObject({ name: "New context", shared: true });
    expect(existsSync(join(sharedContexts(), lib.id, "notes.md"))).toBe(true);
    expect(existsSync(join(P, "contexts", lib.id))).toBe(false);
  });

  it("contexts.list sorts by name and sees the shared library; with from, only the other project's own", async () => {
    await call("contexts.create", { name: "Zeta" }, P);
    await call("contexts.create", { name: "Alpha", shared: true }, P);
    const list = await call<Detail[]>("contexts.list", {}, P);
    expect(list.map((c) => [c.name, c.shared])).toEqual([
      ["Alpha", true],
      ["Zeta", false],
    ]);
    const other = fixtureCopy("ctx-other");
    await call("contexts.create", { name: "Theirs" }, other);
    const theirs = await call<Detail[]>("contexts.list", { from: other }, P);
    expect(theirs.map((c) => c.name)).toEqual(["Theirs"]);
    await expect(call("contexts.list", { from: P }, P)).rejects.toThrow(/That is this project/);
    await expect(call("contexts.list", { from: mkdtempSync(join(tmpdir(), "nope-")) }, P)).rejects.toThrow(
      /is not a project folder/,
    );
  });

  it("contexts.show gives the notes; an unknown id is refused", async () => {
    const c = await call<Detail>("contexts.create", { name: "N" }, P);
    await call("contexts.set", { id: c.id, notes: "Une action par pas." }, P);
    expect(await call<Detail>("contexts.show", { id: c.id }, P)).toMatchObject({
      notes: "Une action par pas.",
      hasNotes: true,
    });
    await expect(call("contexts.show", { id: "ctx-00000000" }, P)).rejects.toThrow(/No context ctx-00000000/);
  });

  it("contexts.set renames, writes notes.md and replaces the paths, trimmed and once each", async () => {
    const c = await call<Detail>("contexts.create", {}, P);
    const set = await call<Detail>(
      "contexts.set",
      { id: c.id, name: " Style ", notes: "x", paths: [" ref/a ", "ref/a", "", "/abs/b"] },
      P,
    );
    expect(set).toMatchObject({ name: "Style", notes: "x", paths: ["ref/a", "/abs/b"] });
    expect(readFileSync(join(P, "contexts", c.id, "notes.md"), "utf8")).toBe("x");
    const blank = await call<Detail>("contexts.set", { id: c.id, name: "   " }, P);
    expect(blank.name).toBe("Style");
    await expect(call("contexts.set", { id: "ctx-missing", name: "a" }, P)).rejects.toThrow(/No context/);
  });

  it("contexts.addFile copies a file or an upload under a free name; removeFile deletes it", async () => {
    const c = await call<Detail>("contexts.create", {}, P);
    const src = join(mkdtempSync(join(tmpdir(), "ctx-src-")), "glossary.txt");
    writeFileSync(src, "terms");
    const a = await call<Detail & { added: string }>("contexts.addFile", { id: c.id, file: src }, P);
    expect(a.added).toBe("glossary.txt");
    const b = await call<Detail & { added: string }>(
      "contexts.addFile",
      { id: c.id, name: "glossary.txt", dataBase64: `data:text/plain;base64,${Buffer.from("up").toString("base64")}` },
      P,
    );
    expect(b.added).toBe("glossary (2).txt");
    expect(readFileSync(join(P, "contexts", c.id, "files", "glossary (2).txt"), "utf8")).toBe("up");
    expect(b.files.sort()).toEqual(["glossary (2).txt", "glossary.txt"]);
    await expect(call("contexts.addFile", { id: c.id, file: "relative.txt" }, P)).rejects.toThrow(/No file/);
    await expect(call("contexts.addFile", { id: c.id }, P)).rejects.toThrow(/Give a file or an upload/);
    const after = await call<Detail>("contexts.removeFile", { id: c.id, name: "glossary.txt" }, P);
    expect(after.files).toEqual(["glossary (2).txt"]);
    await expect(call("contexts.removeFile", { id: c.id, name: "../project.json" }, P)).rejects.toThrow(
      /is not a file of this context/,
    );
    expect(existsSync(join(P, "project.json"))).toBe(true);
  });

  it("contexts.share moves a context to the shared library and back", async () => {
    const c = await call<Detail>("contexts.create", { name: "Moving" }, P);
    await call("contexts.set", { id: c.id, notes: "kept" }, P);
    const shared = await call<Detail>("contexts.share", { id: c.id, shared: true }, P);
    expect(shared).toMatchObject({ shared: true, notes: "kept" });
    expect(existsSync(join(P, "contexts", c.id))).toBe(false);
    expect(existsSync(join(sharedContexts(), c.id))).toBe(true);
    expect(await call<Detail>("contexts.share", { id: c.id, shared: true }, P)).toMatchObject({ shared: true });
    const back = await call<Detail>("contexts.share", { id: c.id, shared: false }, P);
    expect(back).toMatchObject({ shared: false, notes: "kept" });
    expect(existsSync(join(sharedContexts(), c.id))).toBe(false);
  });

  it("contexts.copy brings another project's context here, with a new id when the id is taken", async () => {
    const other = fixtureCopy("ctx-copy");
    const theirs = await call<Detail>("contexts.create", { name: "Borrowed" }, other);
    await call("contexts.set", { id: theirs.id, notes: "from there" }, other);
    const copy = await call<Detail>("contexts.copy", { from: other, id: theirs.id }, P);
    expect(copy).toMatchObject({ id: theirs.id, name: "Borrowed", notes: "from there", shared: false });
    const again = await call<Detail>("contexts.copy", { from: other, id: theirs.id }, P);
    expect(again.id).not.toBe(theirs.id);
    expect(again.name).toBe("Borrowed");
    await expect(call("contexts.copy", { from: other, id: "ctx-nothere" }, P)).rejects.toThrow(/No context/);
  });

  it("contexts.remove deletes the folder and tests that named it stop attaching it", async () => {
    const c = await call<Detail>("contexts.create", {}, P);
    await call("contexts.setTest", { testId: "LFRPS12-1420", contexts: [c.id] }, P);
    expect(await call("contexts.remove", { id: c.id }, P)).toEqual({ id: c.id, removed: true });
    expect(existsSync(join(P, "contexts", c.id))).toBe(false);
    const of = await call<{ effective: string[]; own: string[] | null }>(
      "contexts.ofTest",
      { testId: "LFRPS12-1420" },
      P,
    );
    expect(of).toMatchObject({ effective: [], own: [c.id] });
    await expect(call("contexts.remove", { id: c.id }, P)).rejects.toThrow(/No context/);
  });

  it("contexts.ofTest follows the project until the test has its own list; setTest null goes back", async () => {
    const a = await call<Detail>("contexts.create", { name: "A" }, P);
    const b = await call<Detail>("contexts.create", { name: "B" }, P);
    await call("project.set", { claude: { contexts: [a.id] } }, P);
    const follows = await call("contexts.ofTest", { testId: "LFRPS12-1420" }, P);
    expect(follows).toEqual({ effective: [a.id], own: null, project: [a.id] });
    expect(await call("contexts.setTest", { testId: "LFRPS12-1420", contexts: [b.id] }, P)).toEqual({
      effective: [b.id],
      own: [b.id],
    });
    expect(await call("contexts.setTest", { testId: "LFRPS12-1420", contexts: [] }, P)).toEqual({
      effective: [],
      own: [],
    });
    expect(await call("contexts.setTest", { testId: "LFRPS12-1420", contexts: null }, P)).toEqual({
      effective: [a.id],
      own: null,
    });
    await expect(call("contexts.ofTest", { testId: "NOPE-1" }, P)).rejects.toThrow(/No test NOPE-1/);
    await expect(call("contexts.setTest", { testId: "NOPE-1", contexts: [] }, P)).rejects.toThrow(/No test NOPE-1/);
  });

  it("contexts.ofProject attaches the project's defaults and every test's own list, each once", async () => {
    const a = await call<Detail>("contexts.create", { name: "A" }, P);
    const b = await call<Detail>("contexts.create", { name: "B" }, P);
    await call("project.set", { claude: { contexts: [a.id] } }, P);
    await call("contexts.setTest", { testId: "LFRPS12-1420", contexts: [a.id, b.id] }, P);
    const out = await call<{ effective: string[] }>("contexts.ofProject", {}, P);
    expect(out.effective.sort()).toEqual([a.id, b.id].sort());
  });
});
