import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "../../../../src/core/env.ts";
import { call, fixtureCopy } from "../registry.ts";

type Opened = { dir: string; name: string; jiraProject: string };
type Listed = { last: string; projects: (Opened & { exists: boolean })[] };

beforeEach(() => {
  rmSync(join(env.dataDir(), "settings.json"), { force: true });
});

describe("project.* through the registry, each output against its schema", () => {
  it("project.init makes a project and makes it the current one: no project.open needed after it", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "testimus-proj-reg-")), "ABC");
    const r = await call<Opened & { created: string[] }>("project.init", { dir, jiraProject: "ABC" }, null);
    expect(r).toMatchObject({ dir, name: "ABC", jiraProject: "ABC" });
    expect(r.created).toEqual(expect.arrayContaining(["project.json", "xray.json", "CLAUDE.md"]));
    expect((await call<Listed>("project.list", {}, null)).last).toBe(dir);
  });

  it("project.openKey opens a known project by its key, or makes one beside the last, and makes it current", async () => {
    const root = mkdtempSync(join(tmpdir(), "testimus-proj-key-"));
    const known = await call<Opened>("project.init", { dir: join(root, "LFR"), jiraProject: "LFR" }, null);
    await call("project.init", { dir: join(root, "OTHER"), jiraProject: "OTHER" }, null);
    expect(await call("project.openKey", { key: "lfr" }, null)).toEqual({
      dir: known.dir,
      name: "LFR",
      jiraProject: "LFR",
      created: false,
    });
    expect((await call<Listed>("project.list", {}, null)).last).toBe(known.dir);
    const made = await call<Opened & { created: boolean }>("project.openKey", { key: "NEW1" }, null);
    expect(made).toMatchObject({ dir: join(root, "NEW1"), jiraProject: "NEW1", created: true });
    expect((await call<Listed>("project.list", {}, null)).last).toBe(made.dir);
    await expect(call("project.openKey", { key: "1x" }, null)).rejects.toThrow(/not a Jira project key/);
  });

  it("project.open, project.forget and project.delete manage the known projects", async () => {
    const a = fixtureCopy("proj-a");
    expect(await call<Opened>("project.open", { dir: a }, null)).toMatchObject({ dir: a, jiraProject: "LFRPS12" });
    expect((await call<Listed>("project.list", {}, null)).projects.map((p) => p.dir)).toContain(a);
    expect(await call("project.forget", { dir: a }, null)).toEqual({ dir: a, forgotten: true });
    expect(await call("project.forget", { dir: a }, null)).toEqual({ dir: a, forgotten: false });
    await expect(call("project.delete", { dir: a }, null)).rejects.toThrow(/not a known project/);
    await call("project.open", { dir: a }, null);
    expect(await call("project.delete", { dir: a }, null)).toEqual({ dir: a, deleted: true });
    expect(existsSync(a)).toBe(false);
    await expect(call("project.open", { dir: a }, null)).rejects.toThrow(/not a Testimus project/);
  });

  it("project.info gives project.json, xray.json, the columns and the counts", async () => {
    const p = fixtureCopy("proj-info");
    const info = await call<{ project: { jiraProject: string }; counts: { tests: number; docs: number } }>(
      "project.info",
      {},
      p,
    );
    expect(info.project.jiraProject).toBe("LFRPS12");
    expect(info.counts).toMatchObject({ tests: 3, docs: 2 });
    await expect(call("project.info", {}, null)).rejects.toThrow(/No project is open/);
  });

  it("project.notes and project.setNotes read and write CLAUDE.md with its mtime", async () => {
    const p = fixtureCopy("proj-notes");
    const n = await call<{ text: string; mtime: number }>("project.notes", {}, p);
    const w = await call<{ mtime: number }>("project.setNotes", { text: `${n.text}\nMore`, ifMtime: n.mtime }, p);
    expect((await call<{ text: string; mtime: number }>("project.notes", {}, p)).mtime).toBe(w.mtime);
    await expect(call("project.setNotes", { text: "x", ifMtime: w.mtime - 10_000 }, p)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("project.set changes project.json and gives it back whole", async () => {
    const p = fixtureCopy("proj-set");
    const r = await call<{ name: string; claude: { presets: unknown[] } }>(
      "project.set",
      { name: "Renamed", claude: { presets: [{ label: "A", prompt: "B" }] } },
      p,
    );
    expect(r).toMatchObject({ name: "Renamed", claude: { presets: [{ label: "A", prompt: "B" }] } });
  });
});
