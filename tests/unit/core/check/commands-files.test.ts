import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Ctx, type Progress, quietCtx } from "../../../../src/core/command.ts";
import { commands as checkCommands } from "../../../../src/core/commands/check.ts";
import { commands as xrayCommands } from "../../../../src/core/commands/xray.ts";
import { type ClaudeOut, type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { recordSemantic } from "../../../../src/core/lib/check.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { readCheck, readTest } from "../../../../src/core/lib/store.ts";
import "../../../../src/core/commands/index.ts";

const FIXTURE = new URL("../../../fixtures/project/", import.meta.url);
const DOC = "SOSIE_211_D401-1_3";
const real = env.spawnClaude;
let project = "";
let seen: ClaudeSpawn[] = [];

const all = [...checkCommands, ...xrayCommands];
const run = async (name: string, raw: unknown = {}, ctx?: Ctx): Promise<any> => {
  const c = all.find((x) => x.name === name);
  if (!c) throw new Error(`no command ${name}`);
  return c.run(ctx ?? quietCtx(project), c.input.parse(raw) as never);
};

const line = (m: unknown) => JSON.stringify(m);
const resultLine = (text: string, isError = false) =>
  line({ type: "result", subtype: "success", is_error: isError, result: text, session_id: "s-1", duration_ms: 5 });
const testIdOf = (s: ClaudeSpawn) => /skill on the test ([\w.-]+)\./.exec(s.stdin)?.[1] ?? "";

const toolLine = (name: string, input: unknown) =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", id: `t-${name}`, name, input }] } });

function fakeSkill(
  during: (s: ClaudeSpawn, id: string) => void | Promise<void>,
  out: Partial<ClaudeOut> = {},
  o: { record?: boolean; tools?: (id: string) => string[] } = {},
) {
  env.spawnClaude = async (s) => {
    if (s.args.includes("--version")) return { code: 0, stdout: "2.1.0 (Claude Code)\n", stderr: "" };
    seen.push(s);
    const id = testIdOf(s);
    await during(s, id);
    const lines = [
      ...(o.tools?.(id) ?? []),
      ...(o.record === false ? [] : [toolLine("mcp__testimus__check_record", { findings: [], id })]),
      resultLine("1 error", out.code !== undefined && out.code !== 0),
    ];
    for (const l of lines) s.onLine?.(l);
    return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "", ...out };
  };
}

const wrongObject = {
  step: 2,
  kind: "wrong-object" as const,
  severity: "error" as const,
  message: "Le step 2 teste la vue de traction, pas le TCO du §5.",
  sources: [`${DOC}#§5`],
};

const setReviewLine = (id: string, review: string) => {
  const f = join(project, "tests", id, "test.md");
  writeFileSync(f, readFileSync(f, "utf8").replace(/^review: .*$/m, `review: ${review}`));
};

beforeEach(() => {
  project = join(mkdtempSync(join(tmpdir(), "testimus-checkcmd-")), "LFRPS12");
  cpSync(FIXTURE, project, { recursive: true });
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  seen = [];
});
afterEach(() => {
  env.spawnClaude = real;
});

describe("check commands", () => {
  it("every input field is described", () => {
    for (const c of checkCommands) {
      const shape = (c.input as any).shape as Record<string, { description?: string }>;
      for (const [k, v] of Object.entries(shape)) expect(v.description, `${c.name} ${k}`).toBeTruthy();
    }
  });

  it("check.run needs ids, a folder or all", async () => {
    await expect(run("check.run", {})).rejects.toThrow("Say which tests to check.");
    await expect(run("check.run", { ids: ["LFRPS12-9"] })).rejects.toThrow("No test LFRPS12-9");
    await expect(run("check.run", { folder: "/Nowhere", semantic: false })).rejects.toThrow("No test in the folder");
  });

  it("mechanical only: writes check.json, does not promote a draft", async () => {
    setReviewLine("local-3f9a12c0", "draft");
    const out = await run("check.run", { folder: "/Traction/Sectionneurs", semantic: false });
    expect(out.tests.map((t: any) => t.id).sort()).toEqual(["LFRPS12-1420", "local-3f9a12c0"]);
    expect(out.tests.find((t: any) => t.id === "local-3f9a12c0")).toMatchObject({ review: "draft", errors: 0 });
    expect(readCheck(project, "LFRPS12-1420")?.findings.map((f) => f.kind)).toEqual(["source-missing"]);
    expect(seen).toEqual([]);
  });

  it("semantic pass: one read-only check-test run per test; the skill's findings land in check.json; the review state is left as it is", async () => {
    setReviewLine("local-3f9a12c0", "draft");
    fakeSkill((s, id) => {
      if (id === "LFRPS12-1420") recordSemantic(s.cwd, id, [wrongObject]);
      else recordSemantic(s.cwd, id, []);
    });
    const progress: Progress[] = [];
    const ctx = { ...quietCtx(project), progress: (p: Progress) => progress.push(p) };
    const out = await run("check.run", { ids: ["LFRPS12-1420", "local-3f9a12c0"] }, ctx);
    expect(seen).toHaveLength(2);
    const args = seen[0].args;
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep,Skill");
    expect(seen[0].stdin).toContain("Use the check-test skill on the test");
    expect(seen[0].stdin).toContain("a clean test is a normal result");
    expect(seen.find((s) => testIdOf(s) === "LFRPS12-1420")?.stdin).toContain("step 5 — source-missing (warning)");
    expect(out.totals).toEqual({ errors: 1, warnings: 1, infos: 0 });
    expect(out.failed).toEqual([]);
    const c = readCheck(project, "LFRPS12-1420")!;
    expect(c.findings.map((f) => `${f.step}:${f.kind}:${f.pass}`)).toEqual([
      "2:wrong-object:semantic",
      "5:source-missing:mechanical",
    ]);
    expect(readTest(project, "local-3f9a12c0").test.review).toBe("draft");
    expect(readTest(project, "LFRPS12-1420").test.review).toBe("draft");
    expect(progress.at(-1)).toMatchObject({ done: 2, total: 2 });
    expect(progress.map((p) => p.message).join("\n")).toContain(
      "« Sectionneur sans TK — menu contextuel et propriétés »: 1 error(s), 1 warning(s)",
    );
    expect(
      progress
        .filter((p) => p.test)
        .map((p) => p.test)
        .sort(),
    ).toEqual(["LFRPS12-1420", "local-3f9a12c0"]);
  });

  it("the previous semantic findings are dropped by a new run; every test keeps its review state", async () => {
    recordSemantic(project, "local-3f9a12c0", [{ ...wrongObject, step: 1 }]);
    fakeSkill(() => {});
    const out = await run("check.run", { all: true });
    expect(out.tests.map((t: any) => `${t.id}:${t.review}`)).toEqual([
      "LFRPS12-1398:validated",
      "LFRPS12-1420:draft",
      "local-3f9a12c0:to-fix",
    ]);
    expect(readCheck(project, "local-3f9a12c0")?.findings).toEqual([]);
  });

  it("a failed semantic run leaves a warning finding and the draft stays draft", async () => {
    setReviewLine("local-3f9a12c0", "draft");
    fakeSkill(() => {}, { code: 1 });
    const out = await run("check.run", { ids: ["local-3f9a12c0"] });
    expect(out.failed).toEqual(["local-3f9a12c0"]);
    expect(out.tests[0]).toMatchObject({ ok: false, review: "draft", warnings: 1 });
    expect(readCheck(project, "local-3f9a12c0")?.findings[0]).toMatchObject({ kind: "other", pass: "semantic" });
  });

  it("a check run that edits the test is put back", async () => {
    const file = join(project, "tests", "LFRPS12-1398", "test.md");
    const before = readFileSync(file, "utf8");
    fakeSkill(
      () => writeFileSync(file, `${before}\nedited\n`),
      {},
      { tools: (id) => [toolLine("Edit", { file_path: `tests/${id}/test.md` })] },
    );
    await run("check.run", { ids: ["LFRPS12-1398"] });
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("at most agents.max check-test runs at a time when not adapting, 2 to start with when adapting", async () => {
    writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" }, agents: { max: 3, adaptive: false } });
    for (const n of [1, 2, 3, 4])
      cpSync(join(project, "tests", "LFRPS12-1398"), join(project, "tests", `local-0000000${n}`), { recursive: true });
    let active = 0;
    let peak = 0;
    fakeSkill(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
    });
    const out = await run("check.run", { all: true });
    expect(out.tests).toHaveLength(7);
    expect(seen).toHaveLength(7);
    expect(peak).toBe(3);

    writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
    peak = 0;
    await run("check.run", { all: true });
    expect(peak).toBe(2);
  });

  it("check.record merges the skill's findings and validates them; check.show says when it is stale", async () => {
    const c = await run("check.record", { id: "LFRPS12-1420", findings: [wrongObject] });
    expect(c.findings).toHaveLength(2);
    await expect(
      run("check.record", { id: "LFRPS12-1420", findings: [{ ...wrongObject, kind: "nonsense" }] }),
    ).rejects.toThrow();
    await expect(run("check.record", { id: "nope-1", findings: [] })).rejects.toThrow("No test nope-1");
    expect(await run("check.show", { id: "LFRPS12-1420" })).toMatchObject({ stale: false, check: c });
    const f = join(project, "tests", "LFRPS12-1420", "test.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("Choisir Propriétés.", "Choisir Propriétés dans le menu."));
    expect((await run("check.show", { id: "LFRPS12-1420" })).stale).toBe(true);
    setReviewLine("LFRPS12-1420", "validated");
    expect(await run("check.show", { id: "LFRPS12-1398" })).toEqual({ id: "LFRPS12-1398", check: null, stale: false });
  });

  it("a review decision does not make the findings stale", async () => {
    await run("check.record", { id: "LFRPS12-1420", findings: [] });
    setReviewLine("LFRPS12-1420", "to-fix");
    expect((await run("check.show", { id: "LFRPS12-1420" })).stale).toBe(false);
  });
});
