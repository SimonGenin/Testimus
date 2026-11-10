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
import {
  answerCheck,
  type CheckAnswer,
  checkedIn,
  resultLine,
  toolLine,
  verdictsOf,
} from "../../helpers/fake-check.ts";
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

// ponytail: a check request names its tests; the fake records each one as the skill does, unless the run fails
function fakeSkill(
  during: (s: ClaudeSpawn, ids: string[]) => void | Promise<void>,
  out: Partial<ClaudeOut> = {},
  o: CheckAnswer & { tools?: (ids: string[]) => string[] } = {},
) {
  env.spawnClaude = async (s) => {
    if (s.args.includes("--version")) return { code: 0, stdout: "2.1.0 (Claude Code)\n", stderr: "" };
    seen.push(s);
    const ids = checkedIn(s.stdin);
    await during(s, ids);
    const failed = out.code !== undefined && out.code !== 0;
    const lines = failed ? [resultLine("1 error", true)] : [...(o.tools?.(ids) ?? []), ...(await answerCheck(s, o))];
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

  it("semantic pass: one read-only check-test request for the tests, each recorded on its own; the skill's findings land in check.json; the review state is left as it is", async () => {
    setReviewLine("local-3f9a12c0", "draft");
    fakeSkill(
      () => {},
      {},
      {
        findings: (id) => (id === "LFRPS12-1420" ? [wrongObject] : []),
        steps: (id) =>
          verdictsOf(project, id).map((v) =>
            id === "LFRPS12-1420" && v.step === 2 ? { ...v, verdict: "unsupported" as const } : v,
          ),
      },
    );
    const progress: Progress[] = [];
    const ctx = { ...quietCtx(project), progress: (p: Progress) => progress.push(p) };
    const out = await run("check.run", { ids: ["LFRPS12-1420", "local-3f9a12c0"] }, ctx);
    expect(seen).toHaveLength(1);
    const args = seen[0].args;
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep,Skill");
    expect(seen[0].stdin.split("\n")[0]).toBe(
      "Use the check-test skill on the 2 tests below. Read each one with tests_show; never modify a test or any other file.",
    );
    expect(seen[0].stdin).toContain(
      "- findings: only what a passage proves and a reviewer would act on (the bar of the skill); [] is a normal result.",
    );
    expect(seen[0].stdin).toContain(
      "- LFRPS12-1420 — « Sectionneur sans TK — menu contextuel et propriétés », 5 steps. Already recorded by the mechanical pass, do not repeat:\n  - step 5 — source-missing (warning)",
    );
    expect(seen[0].stdin).toContain(
      "- local-3f9a12c0 — « Sectionneur avec TK — manœuvre régulière », 2 steps. The mechanical pass found nothing.",
    );
    expect(out.totals).toEqual({ errors: 1, warnings: 1, infos: 0 });
    expect(out.failed).toEqual([]);
    expect(out.tests.map((t: any) => [t.id, t.ok, t.summary])).toEqual([
      ["LFRPS12-1420", true, "LFRPS12-1420: 1 error(s), 0 warning(s), 0 info(s)."],
      ["local-3f9a12c0", true, "local-3f9a12c0: 0 error(s), 0 warning(s), 0 info(s)."],
    ]);
    const c = readCheck(project, "LFRPS12-1420")!;
    expect(c.findings.map((f) => `${f.step}:${f.kind}:${f.pass}`)).toEqual([
      "2:wrong-object:semantic",
      "5:source-missing:mechanical",
    ]);
    expect(c.verdicts?.map((v) => `${v.step}:${v.verdict}`)).toEqual([
      "1:supported",
      "2:unsupported",
      "3:supported",
      "4:supported",
      "5:unverified",
    ]);
    expect(readCheck(project, "local-3f9a12c0")?.verdicts).toHaveLength(2);
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
    expect(seen).toHaveLength(1);
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
      { tools: (ids) => ids.map((id) => toolLine("Edit", { file_path: `tests/${id}/test.md` })) },
    );
    const logs: string[] = [];
    await run("check.run", { ids: ["LFRPS12-1398"] }, { ...quietCtx(project), log: (_l, m) => logs.push(m) });
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(logs).toContain("The check run edited « Disjoncteur — ouverture à distance »; the edit was put back.");
  });

  it("at most agents.max check-test requests at a time when not adapting, 2 to start with when adapting", async () => {
    writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" }, agents: { max: 3, adaptive: false } });
    for (let n = 1; n <= 13; n++)
      cpSync(join(project, "tests", "LFRPS12-1398"), join(project, "tests", `local-${String(n).padStart(8, "0")}`), {
        recursive: true,
      });
    let active = 0;
    let peak = 0;
    fakeSkill(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
    });
    const out = await run("check.run", { all: true });
    expect(out.tests).toHaveLength(16);
    expect(out.failed).toEqual([]);
    expect(seen.map((s) => checkedIn(s.stdin).length)).toEqual([4, 4, 4, 4]);
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
