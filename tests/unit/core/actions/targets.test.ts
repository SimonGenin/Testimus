import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { listActions, proposeAction, targetOf } from "../../../../src/core/lib/actions.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import type { ClaudeAction, ClaudeScope } from "../../../../src/core/types.ts";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/project/", import.meta.url));
const DOC = "SOSIE_211_D401-1_3";
const DOC2 = "SOSIE_211_D401-1_4";
const TEST = "LFRPS12-1420";
const LOCAL = "local-3f9a12c0";
const GEN = "job-gen-1";

let dir = "";
beforeEach(() => {
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  dir = join(mkdtempSync(join(tmpdir(), "testimus-targets-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  mkdirSync(join(dir, ".testimus", "gen"), { recursive: true });
  writeFileSync(
    join(dir, ".testimus", "gen", `${GEN}.json`),
    JSON.stringify({
      at: "2026-11-08T19:52:00Z",
      input: { request: "Le sectionneur avec et sans TK" },
      tests: [LOCAL],
      consulted: [],
      searched: [],
      skipped: [{ item: "A", category: "Pas de source", why: "w" }],
    }),
  );
});

const by = (at: string) => ({ run: "check", model: "opus", effort: "high" as const, at });
let n = 0;
const propose = (scope: ClaudeScope, where?: string, title = `Action ${++n}`) =>
  proposeAction(dir, {
    title,
    scope,
    ...(where ? { where } : {}),
    problem: `Problem ${title}`,
    why: "w",
    plan: ["p"],
    proposedBy: by("2026-11-08T10:00:00Z"),
  });

describe("what a Claude action works on", () => {
  it("is read from the problem's place and the scope: a step is its test's, a generation's problem its generation's", () => {
    expect(targetOf("project", { kind: "step", testId: TEST, step: 2 })).toEqual({ kind: "test", id: TEST });
    expect(targetOf(`doc:${DOC}`, { kind: "doc", docId: DOC })).toEqual({ kind: "document", id: DOC });
    expect(targetOf(`gen:${GEN}`, { kind: "project" })).toEqual({ kind: "generation", id: GEN });
    expect(targetOf("job:j-9", { kind: "project" })).toEqual({ kind: "job", id: "j-9" });
    expect(targetOf("job:j-9", { kind: "doc", docId: DOC })).toEqual({ kind: "document", id: DOC });
    expect(targetOf(`test:${TEST}`, { kind: "tests", testIds: [TEST, LOCAL] })).toEqual({ kind: "test", id: TEST });
    expect(targetOf("project", { kind: "project" })).toEqual({ kind: "project", id: "" });
  });

  it("is written in the action file when proposed, and an older file without one is read from where and scope", () => {
    const a = propose({ kind: "test", testId: LOCAL });
    const file = join(dir, ".testimus", "actions", `${a.id}.json`);
    const saved = JSON.parse(readFileSync(file, "utf8")) as ClaudeAction;
    expect(saved.target).toEqual({ kind: "test", id: LOCAL });
    const { target: _gone, ...old } = saved;
    writeFileSync(file, JSON.stringify(old));
    expect(listActions(dir)[0].target).toMatchObject({ kind: "test", id: LOCAL });
  });

  it("is named for a person — summary, title and code, request and date, project name — never by an id", async () => {
    propose({ kind: "test", testId: LOCAL });
    propose({ kind: "doc", docId: DOC });
    propose({ kind: "project" }, `gen:${GEN}`);
    propose({ kind: "project" });
    const listed = (await invoke("actions.list", {}, { project: dir })) as (ClaudeAction & {
      target: { kind: string; name: string; code?: string; at?: string };
    })[];
    const t = (kind: string) => listed.find((a) => a.target.kind === kind)?.target;
    expect(t("test")?.name).not.toMatch(/local-/);
    expect(t("test")?.name.length).toBeGreaterThan(0);
    expect(t("document")).toMatchObject({ name: "Traction", code: DOC });
    expect(t("generation")).toMatchObject({ name: "Le sectionneur avec et sans TK", at: "2026-11-08T19:52:00Z" });
    expect(t("project")?.name).not.toBe("");
  });

  it("orders every list: the target in view first, then project, documents, tests, generations, jobs; by name; by date", async () => {
    const t2 = propose({ kind: "test", testId: TEST }, undefined, "t2");
    const g = propose({ kind: "project" }, `gen:${GEN}`, "g");
    const d2 = propose({ kind: "doc", docId: DOC2 }, undefined, "d2");
    const t1 = propose({ kind: "test", testId: TEST }, undefined, "t1");
    const p = propose({ kind: "project" }, undefined, "p");
    const d1 = propose({ kind: "doc", docId: DOC }, undefined, "d1");
    const l = propose({ kind: "test", testId: LOCAL }, undefined, "l");
    const order = async (input: Record<string, unknown>) =>
      ((await invoke("actions.list", input, { project: dir })) as ClaudeAction[]).map((a) => a.title);
    const file = join(dir, ".testimus", "actions", `${t1.id}.json`);
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), at: "2026-11-08T09:00:00Z" }));
    const all = await order({});
    expect(all.slice(0, 3)).toEqual([p.title, d2.title, d1.title]);
    expect(all.at(-1)).toBe(g.title);
    expect(all.indexOf(t1.title) + 1).toBe(all.indexOf(t2.title));
    expect(all).toContain(l.title);
    const viewed = await order({ view: { kind: "document", id: DOC2 } });
    expect(viewed[0]).toBe(d2.title);
    expect(viewed[1]).toBe(p.title);
    expect(viewed).toContain(d1.title);
  });
});
