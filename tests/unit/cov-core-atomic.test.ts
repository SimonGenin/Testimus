import * as fs from "node:fs";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readContextFile } from "../../src/core/claude/prompt.ts";
import { quietCtx } from "../../src/core/command.ts";
import { commands as contexts } from "../../src/core/commands/contexts.ts";
import { commands as project } from "../../src/core/commands/project.ts";
import { copyDirAtomic, writeAtomic } from "../../src/core/lib/atomic.ts";
import { credsDir, JIRA_FILE, saveCreds } from "../../src/core/lib/creds.ts";
import { docDir, writeContext } from "../../src/core/lib/docs.ts";

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return { ...real, renameSync: vi.fn(real.renameSync), writeFileSync: vi.fn(real.writeFileSync) };
});

const FIXTURE = resolve(import.meta.dirname, "../fixtures/project");
const DOC = "SOSIE_211_D401-1_3";
const all = [...contexts, ...project];
let P = "";

const run = async <T>(name: string, input: unknown = {}): Promise<T> => {
  const c = all.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return (await c.run(quietCtx(P), c.input.parse(input) as never)) as T;
};

const rename = vi.mocked(fs.renameSync);
const write = vi.mocked(fs.writeFileSync);
const tmpsIn = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".tmp"));
const failRename = () =>
  rename.mockImplementationOnce(() => {
    throw Object.assign(new Error("EPERM: rename refused"), { code: "EPERM" });
  });

const expectAtomic = (file: string) => {
  const w = write.mock.calls.findLast((c) => String(c[0]).startsWith(file));
  expect(String(w?.[0])).toBe(`${file}.tmp`);
  expect(rename.mock.calls.findLast((c) => String(c[1]) === file)?.[0]).toBe(`${file}.tmp`);
};

beforeEach(() => {
  P = mkdtempSync(join(tmpdir(), "testimus-atomic-"));
  cpSync(FIXTURE, P, { recursive: true });
  rename.mockClear();
  write.mockClear();
});

describe("atomic writes: temp file, then rename", () => {
  it("store.writeAtomic writes <file>.tmp, renames it, and keeps the old content and no .tmp when the rename fails", () => {
    const dir = join(P, "atomic");
    const file = join(dir, "x.md");
    writeAtomic(file, "one");
    expectAtomic(file);
    expect(readFileSync(file, "utf8")).toBe("one");
    expect(tmpsIn(dir)).toEqual([]);
    failRename();
    expect(() => writeAtomic(file, "two")).toThrow("EPERM");
    expect(tmpsIn(dir)).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe("one");
  });

  it("saveCreds goes through a temp file per credentials file, and a failed rename keeps the old file", () => {
    saveCreds({ baseUrl: "https://a.atlassian.net", email: "a@b.c", apiToken: "t1" }, {});
    const file = join(credsDir(), JIRA_FILE);
    expectAtomic(file);
    expect(JSON.parse(readFileSync(file, "utf8")).apiToken).toBe("t1");
    expect(tmpsIn(credsDir())).toEqual([]);
    const before = readFileSync(file, "utf8");
    failRename();
    expect(() => saveCreds({ apiToken: "t2" }, {})).toThrow("EPERM");
    expect(tmpsIn(credsDir())).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("project.setNotes writes CLAUDE.md atomically, and a failed rename keeps the old notes", async () => {
    const file = join(P, "CLAUDE.md");
    await run("project.setNotes", { text: "# Notes\n" });
    expectAtomic(file);
    expect(readFileSync(file, "utf8")).toBe("# Notes\n");
    expect(tmpsIn(P)).toEqual([]);
    failRename();
    await expect(run("project.setNotes", { text: "lost" })).rejects.toThrow("EPERM");
    expect(tmpsIn(P)).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe("# Notes\n");
  });

  it("contexts.set writes context.md atomically, and a failed rename keeps the old notes", async () => {
    const c = await run<{ id: string }>("contexts.create", { name: "Style" });
    await run("contexts.set", { id: c.id, notes: "Une action par pas." });
    const dir = join(P, "contexts", c.id);
    const file = join(dir, "context.md");
    expectAtomic(file);
    expect(readContextFile(dir).notes).toBe("Une action par pas.");
    expect(tmpsIn(dir)).toEqual([]);
    failRename();
    await expect(run("contexts.set", { id: c.id, notes: "lost" })).rejects.toThrow("EPERM");
    expect(tmpsIn(dir)).toEqual([]);
    expect(readContextFile(dir).notes).toBe("Une action par pas.");
  });

  it("docs writeContext writes context.md atomically, and a failed rename keeps the old context", () => {
    const dir = docDir(P, DOC);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "context.md");
    writeContext(P, DOC, "Glossaire");
    expectAtomic(file);
    expect(readFileSync(file, "utf8")).toBe("Glossaire\n");
    expect(tmpsIn(dir)).toEqual([]);
    failRename();
    expect(() => writeContext(P, DOC, "lost")).toThrow("EPERM");
    expect(tmpsIn(dir)).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe("Glossaire\n");
  });

  it("test.md and project.json go through the same write: a failed rename keeps them whole", async () => {
    const dir = join(P, "tests", "LFRPS12-1420");
    const md = join(dir, "test.md");
    const { commands: tests } = await import("../../src/core/commands/tests.ts");
    const edit = tests.find((x) => x.name === "tests.edit");
    if (!edit) throw new Error("no tests.edit");
    await edit.run(quietCtx(P), edit.input.parse({ id: "LFRPS12-1420", summary: "Atomic" }) as never);
    expectAtomic(md);
    expect(readFileSync(md, "utf8")).toContain("Atomic");
    failRename();
    await expect(
      edit.run(quietCtx(P), edit.input.parse({ id: "LFRPS12-1420", summary: "Lost" }) as never),
    ).rejects.toThrow("EPERM");
    expect(readFileSync(md, "utf8")).toContain("Atomic");
    expect(tmpsIn(dir)).toEqual([]);
    const pj = join(P, "project.json");
    const was = readFileSync(pj, "utf8");
    failRename();
    await expect(run("project.set", { name: "Lost" })).rejects.toThrow("EPERM");
    expect(readFileSync(pj, "utf8")).toBe(was);
    expect(tmpsIn(P)).toEqual([]);
  });

  it("a folder is copied beside its target then renamed; a failed rename leaves neither a half copy nor a .tmp", () => {
    const src = join(P, "src-dir");
    mkdirSync(join(src, "sub"), { recursive: true });
    fs.writeFileSync(join(src, "sub", "a.txt"), "A");
    const to = join(P, "copies", "dest");
    copyDirAtomic(src, to);
    expect(readFileSync(join(to, "sub", "a.txt"), "utf8")).toBe("A");
    expect(rename.mock.calls.at(-1)).toEqual([`${to}.tmp`, to]);
    expect(readdirSync(join(P, "copies"))).toEqual(["dest"]);
    failRename();
    expect(() => copyDirAtomic(src, join(P, "copies", "other"))).toThrow("EPERM");
    expect(readdirSync(join(P, "copies"))).toEqual(["dest"]);
  });

  it("no file the app owns is written in place: every write in src/core goes through writeAtomic", () => {
    const root = resolve(import.meta.dirname, "../../src/core");
    const files = (fs.readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts"));
    const writes =
      /\b(writeFileSync|copyFileSync|createWriteStream|appendFileSync|writeFile|copyFile|appendFile|cpSync|cp)\(/;
    const direct = files.filter((f) => writes.test(readFileSync(join(root, f), "utf8")));
    // ponytail: the helper itself, the job logs (append-only lines), the --mock fakes, and the machine-local model
    // files (downloads, perf lines) — none of them a project or user file
    const allowed = /^(lib[\\/]atomic\.ts|jobs\.ts|mock[\\/]|lib[\\/]models-|rag[\\/]runtimes[\\/]llamacpp\.ts)/;
    expect(direct.filter((f) => !allowed.test(f))).toEqual([]);
  });
});
