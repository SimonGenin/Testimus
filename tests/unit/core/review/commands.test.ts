import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { revert } from "../../../../src/core/claude/snapshot.ts";
import { quietCtx } from "../../../../src/core/command.ts";
import { commands as reviewCommands } from "../../../../src/core/commands/review.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { recordSemantic } from "../../../../src/core/lib/check.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { osUser } from "../../../../src/core/lib/review.ts";
import { readCheck, readTest } from "../../../../src/core/lib/store.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-check.ts";
import "../../../../src/core/commands/index.ts";
import { checkOut, isCheck } from "../../helpers/fake-check.ts";

const FIXTURE = new URL("../../../fixtures/project/", import.meta.url);
const DOC = "SOSIE_211_D401-1_3";
const real = env.spawnClaude;
const realNow = env.now;
let project = "";
let seen: ClaudeSpawn[] = [];

const run = async (name: string, raw: unknown = {}): Promise<any> => {
  const c = reviewCommands.find((x) => x.name === name);
  if (!c) throw new Error(`no command ${name}`);
  return c.run(quietCtx(project), c.input.parse(raw) as never);
};
const testFile = (id: string) => join(project, "tests", id, "test.md");
const result = (text: string) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
    session_id: "s",
    duration_ms: 5,
  });

function fake(during: (s: ClaudeSpawn) => void) {
  env.spawnClaude = async (s) => {
    seen.push(s);
    if (isCheck(s)) return checkOut(s);
    during(s);
    const l = result("done");
    s.onLine?.(l);
    return { code: 0, stdout: `${l}\n`, stderr: "" };
  };
}

beforeEach(() => {
  project = join(mkdtempSync(join(tmpdir(), "testimus-review-")), "LFRPS12");
  cpSync(FIXTURE, project, { recursive: true });
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  seen = [];
  env.now = () => new Date("2026-11-02T10:00:00.000Z");
});
afterEach(() => {
  env.spawnClaude = real;
  env.now = realNow;
});

describe("review commands", () => {
  it("every input field is described", () => {
    for (const c of reviewCommands) {
      const shape = (c.input as any).shape as Record<string, { description?: string }>;
      for (const [k, v] of Object.entries(shape)) expect(v.description, `${c.name} ${k}`).toBeTruthy();
    }
  });
});

describe("review.set", () => {
  it("to-fix needs a note", async () => {
    await expect(run("review.set", { id: "LFRPS12-1420", decision: "to-fix" })).rejects.toThrow("needs a note");
    await expect(run("review.set", { id: "LFRPS12-1420", decision: "to-fix", note: "  " })).rejects.toThrow(
      "needs a note",
    );
    expect(readTest(project, "LFRPS12-1420").test.review).toBe("draft");
  });

  it("to-fix records the note, the reviewer and the time; the findings stay fresh", async () => {
    recordSemantic(project, "LFRPS12-1420", []);
    const hash = readCheck(project, "LFRPS12-1420")!.testHash;
    const out = await run("review.set", {
      id: "LFRPS12-1420",
      decision: "to-fix",
      note: 'Step 2: nommer "Propriétés"',
    });
    expect(out).toEqual({
      id: "LFRPS12-1420",
      review: "to-fix",
      reviewNote: 'Step 2: nommer "Propriétés"',
      reviewedBy: osUser(),
      reviewedAt: "2026-11-02T10:00:00.000Z",
    });
    const md = readFileSync(testFile("LFRPS12-1420"), "utf8");
    expect(md).toContain('review_note: "Step 2: nommer \\"Propriétés\\""');
    expect(md).toContain("generated_by: gen-tests-1a2b3c4d");
    expect(readTest(project, "LFRPS12-1420").test.steps).toHaveLength(5);
    expect(readCheck(project, "LFRPS12-1420")!.testHash).toBe(hash);
  });

  it("validate clears an old note", async () => {
    const out = await run("review.set", { id: "local-3f9a12c0", decision: "validate" });
    expect(out.review).toBe("validated");
    expect(out.reviewNote).toBeUndefined();
    expect(readFileSync(testFile("local-3f9a12c0"), "utf8")).not.toContain("review_note");
    await expect(run("review.set", { id: "nope-1", decision: "validate" })).rejects.toThrow("No test nope-1");
  });

  it("draft takes a To fix mark off: no note, no reviewer, the findings stay fresh", async () => {
    recordSemantic(project, "LFRPS12-1420", []);
    const hash = readCheck(project, "LFRPS12-1420")!.testHash;
    await run("review.set", { id: "LFRPS12-1420", decision: "to-fix", note: "Step 2" });
    const out = await run("review.set", { id: "LFRPS12-1420", decision: "draft" });
    expect(out).toEqual({ id: "LFRPS12-1420", review: "draft" });
    const md = readFileSync(testFile("LFRPS12-1420"), "utf8");
    expect(md).not.toMatch(/review_note|reviewed_by|reviewed_at/);
    expect(readTest(project, "LFRPS12-1420").test.review).toBe("draft");
    expect(readCheck(project, "LFRPS12-1420")!.testHash).toBe(hash);
  });
});

describe("review.queue", () => {
  it("lists drafts and to-fix tests, never validated; default order is by state", async () => {
    const out = await run("review.queue");
    expect(out.tests.map((t: any) => `${t.id}:${t.review}`)).toEqual(["LFRPS12-1420:draft", "local-3f9a12c0:to-fix"]);
    expect(out.tests[0]).toMatchObject({
      errors: 2,
      warnings: 2,
      stale: false,
      unchecked: false,
      folder: "/Traction/Sectionneurs",
    });
    expect(out.tests[1]).toMatchObject({
      unchecked: true,
      note: "Le step 2 doit vérifier que seul Propriétés est proposé.",
    });
    expect(out.counts).toEqual({ toFix: 1, draft: 1, unchecked: 1, validated: 0 });
  });

  it("lists the generated tests already validated when asked, never a hand-made one", async () => {
    await run("review.set", { id: "LFRPS12-1420", decision: "validate" });
    const out = await run("review.queue", { state: ["validated"] });
    expect(out.tests.map((t: any) => `${t.id}:${t.review}`)).toEqual(["LFRPS12-1420:validated"]);
    expect(out.counts).toMatchObject({ draft: 0, toFix: 1, validated: 1 });
  });

  it("sorts by anomalies and filters by state, folder and findings", async () => {
    for (const [id, review] of [
      ["local-00000001", "review: draft\ngenerated_by: gen-1"],
      ["local-00000002", "review: draft"],
    ]) {
      cpSync(join(project, "tests", "LFRPS12-1398"), join(project, "tests", id), { recursive: true });
      const f = testFile(id);
      writeFileSync(
        f,
        readFileSync(f, "utf8")
          .replace("review: validated", review)
          .replace(/^key: .*\n/m, ""),
      );
    }
    recordSemantic(project, "local-3f9a12c0", [
      ...[1, 2, 3].map((step) => ({
        step: 1,
        kind: "unsupported" as const,
        severity: "error" as const,
        message: `m${step}`,
        sources: [],
      })),
    ]);
    const byState = await run("review.queue");
    expect(byState.tests.map((t: any) => t.id)).toEqual(["LFRPS12-1420", "local-00000001", "local-3f9a12c0"]);
    expect(byState.tests[1]).toMatchObject({ review: "draft", unchecked: true });
    const byAnomalies = await run("review.queue", { sort: "anomalies" });
    expect(byAnomalies.tests.map((t: any) => t.id)).toEqual(["local-3f9a12c0", "LFRPS12-1420", "local-00000001"]);
    expect((await run("review.queue", { state: ["draft"] })).tests.map((t: any) => t.id)).toEqual([
      "LFRPS12-1420",
      "local-00000001",
    ]);
    expect((await run("review.queue", { folder: "/Traction/Disjoncteurs" })).tests.map((t: any) => t.id)).toEqual([
      "local-00000001",
    ]);
    expect((await run("review.queue", { folder: "/Traction" })).tests).toHaveLength(3);
    expect((await run("review.queue", { withFindings: true })).tests.map((t: any) => t.id)).toEqual([
      "LFRPS12-1420",
      "local-3f9a12c0",
    ]);
    const folder = await run("review.queue", { sort: "folder" });
    expect(folder.tests.map((t: any) => t.folder)).toEqual([
      "/Traction/Disjoncteurs",
      "/Traction/Sectionneurs",
      "/Traction/Sectionneurs",
    ]);
  });

  it("a test edited since its check shows stale", async () => {
    const f = testFile("LFRPS12-1420");
    writeFileSync(f, readFileSync(f, "utf8").replace("Choisir Propriétés.", "Choisir Propriétés dans le menu."));
    expect((await run("review.queue")).tests[0]).toMatchObject({ id: "LFRPS12-1420", stale: true });
  });
});

describe("review.fix", () => {
  it("runs fix-test with the note and findings, re-checks, and leaves the test checked", async () => {
    recordSemantic(project, "local-3f9a12c0", [
      {
        step: 2,
        kind: "vague-result",
        severity: "warning",
        message: "« Le menu contextuel s'ouvre. » est vague.",
        sources: [`${DOC}#§5.6.6`],
      },
    ]);
    fake((s) => {
      const id = /fix-test skill on the test ([\w.-]+)\./.exec(s.stdin)?.[1] ?? "";
      const f = join(s.cwd, "tests", id, "test.md");
      writeFileSync(
        f,
        readFileSync(f, "utf8").replace("Le menu contextuel s'ouvre.", "Le menu contextuel ne propose que Propriétés."),
      );
    });
    const out = await run("review.fix", { id: "local-3f9a12c0" });
    expect(seen).toHaveLength(2);
    const fix = seen[0];
    expect(fix.stdin).toContain("Scope: the whole test local-3f9a12c0.");
    expect(fix.stdin).toContain("Use the fix-test skill on the test local-3f9a12c0.");
    expect(fix.stdin).toContain(`Reviewer's note (To fix): "Le step 2 doit vérifier que seul Propriétés est proposé."`);
    expect(fix.stdin).toContain("step 2 — vague-result (warning)");
    expect(fix.args[fix.args.indexOf("--tools") + 1]).toContain("Edit");
    expect(seen[1].stdin.split("\n").slice(0, 3)).toEqual([
      "Use the check-test skill on the test below. Read it with tests_show; never modify a test or any other file.",
      "",
      "- local-3f9a12c0 — « Sectionneur avec TK — manœuvre régulière », 2 steps. The mechanical pass found nothing.",
    ]);
    expect(out).toMatchObject({ ok: true, changedSteps: [2], review: "draft" });
    expect(out.check.findings).toEqual([]);
    expect(out.check.verdicts.map((v: { verdict: string }) => v.verdict)).toEqual(["supported", "supported"]);
    const t = readTest(project, "local-3f9a12c0").test;
    expect(t.review).toBe("draft");
    expect(t.steps[1].fields["Expected Result"]).toBe("Le menu contextuel ne propose que Propriétés.");

    revert(project, out.runId);
    expect(readTest(project, "local-3f9a12c0").test).toMatchObject({ review: "to-fix" });
  });

  it("a failed fix run leaves the test to-fix and its check.json alone", async () => {
    const before = readCheck(project, "LFRPS12-1420");
    env.spawnClaude = async () => ({ code: 1, stdout: "", stderr: "Credit balance is too low" });
    writeFileSync(
      testFile("LFRPS12-1420"),
      readFileSync(testFile("LFRPS12-1420"), "utf8").replace("review: draft", "review: to-fix"),
    );
    const out = await run("review.fix", { id: "LFRPS12-1420", note: "Nommer les commandes au step 2" });
    expect(out).toMatchObject({ ok: false, review: "to-fix", changedSteps: [] });
    expect(out.diagnosis?.kind).toBe("credit");
    expect(readCheck(project, "LFRPS12-1420")).toEqual(before);
  });

  it("with a note, marks the test To fix with it before the run (one gesture: To fix + Ask Claude)", async () => {
    let during: { review: string; note?: string; by?: string } | null = null;
    env.spawnClaude = async (s) => {
      const t = readTest(s.cwd, "LFRPS12-1420").test;
      during ??= { review: t.review, note: t.reviewNote, by: t.reviewedBy };
      return { code: 1, stdout: "", stderr: "Credit balance is too low" };
    };
    expect(readTest(project, "LFRPS12-1420").test.review).toBe("draft");
    const out = await run("review.fix", { id: "LFRPS12-1420", note: "  Nommer les commandes au step 2 " });
    expect(during).toEqual({ review: "to-fix", note: "Nommer les commandes au step 2", by: osUser() });
    expect(out).toMatchObject({ ok: false, review: "to-fix" });
    expect(readTest(project, "LFRPS12-1420").test).toMatchObject({
      review: "to-fix",
      reviewNote: "Nommer les commandes au step 2",
      reviewedAt: "2026-11-02T10:00:00.000Z",
    });
  });

  it("without a note, leaves the review state as it is", async () => {
    env.spawnClaude = async () => ({ code: 1, stdout: "", stderr: "Credit balance is too low" });
    const out = await run("review.fix", { id: "LFRPS12-1420" });
    expect(out.review).toBe("draft");
  });
});

describe("--mock review loop (scripted check-test and fix-test)", () => {
  it("check records realistic findings, fix applies the note, the re-check is clean", async () => {
    env.spawnClaude = mockSpawnClaude;
    const { commands: checkCommands } = await import("../../../../src/core/commands/check.ts");
    const check = checkCommands.find((c) => c.name === "check.run")!;
    const out: any = await check.run(
      quietCtx(project),
      check.input.parse({ ids: ["LFRPS12-1420", "local-3f9a12c0"] }) as never,
    );
    expect(out.failed).toEqual([]);
    const k1420 = readCheck(project, "LFRPS12-1420")!.findings.map((f) => `${f.step ?? "-"}:${f.kind}`);
    expect(k1420).toEqual(["-:negative-missing", "5:source-missing", "5:not-simulated-unsourced"]);
    expect(readCheck(project, "local-3f9a12c0")!.findings.map((f) => `${f.step}:${f.kind}`)).toEqual([
      "2:vague-result",
    ]);

    const fixed = await run("review.fix", { id: "local-3f9a12c0" });
    expect(fixed).toMatchObject({ ok: true, review: "draft", changedSteps: [2] });
    expect(fixed.summary).toContain("step 2");
    expect(fixed.check.findings.filter((f: any) => f.severity !== "info")).toEqual([]);

    const f1420 = await run("review.fix", {
      id: "LFRPS12-1420",
      note: "Ajouter le cas avec TK.",
    });
    expect(f1420.ok).toBe(true);
    const t = readTest(project, "LFRPS12-1420").test;
    expect(t.steps).toHaveLength(6);
    expect(existsSync(join(project, ".testimus", "runs", f1420.runId, "run.json"))).toBe(true);
  });
});
