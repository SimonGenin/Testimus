import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mcpAccess } from "../../../../src/core/claude/access.ts";
import { osUser } from "../../../../src/core/lib/review.ts";
import { call, fixtureCopy } from "../registry.ts";

const RUN = "recette-j5-sectionneurs";
const T1420 = "LFRPS12-1420";
const TLOCAL = "local-3f9a12c0";
let project = "";

beforeEach(() => {
  project = fixtureCopy("runs");
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

const show = (run = RUN) => call<any>("runs.show", { run }, project);
const resultOf = async (id: string, run = RUN) => (await show(run)).tests.find((t: any) => t.id === id).result;

describe("runs.list and runs.show", () => {
  it("lists the runs newest first with their counts, open questions and whether they are finished", async () => {
    const { runs } = await call<any>("runs.list", {}, project);
    expect(runs.map((r: any) => r.slug)).toEqual([RUN, "recette-j4-traction"]);
    expect(runs[0]).toMatchObject({
      name: "Recette J5 — Sectionneurs",
      version: "SOSIE 2.4.0-rc2",
      environment: "Simulator room B",
      total: 3,
      counts: { passed: 1, problem: 1, blocked: 0, notRun: 1 },
      openQuestions: 1,
      finished: false,
    });
    expect(runs[1]).toMatchObject({ total: 1, finished: true, counts: { passed: 1 } });
  });

  it("shows each frozen test with its result; a test without a result file is not run, one mark per step", async () => {
    const run = await show();
    expect(run.tests.map((t: any) => t.id)).toEqual([T1420, TLOCAL, "LFRPS12-1398"]);
    const t = run.tests[0];
    expect(t.key).toBe(T1420);
    expect(t.preconditions).toEqual(["LFRPS12-77"]);
    expect(Object.keys(t.steps[0].fields)).toEqual(["Action", "Expected Result", "Exigence"]);
    expect(t.steps[0].images).toEqual(["images/fig-40.png"]);
    expect(run.tests[2].result).toEqual({
      status: "not-run",
      steps: [{ ok: null }],
      comments: [],
      attachments: [],
      proposed: null,
      openQuestions: 0,
    });
    expect(run.tests[1].result.openQuestions).toBe(1);
  });

  it("refuses a run that does not exist, and a name that is not a run folder", async () => {
    await expect(show("nope")).rejects.toThrow(/No run nope/);
    await expect(call("runs.show", { run: "../tests" }, project)).rejects.toThrow(/Invalid input/);
  });
});

describe("runs.create", () => {
  it("freezes the tests named, in their order, with copies of their pictures", async () => {
    const out = await call<any>(
      "runs.create",
      { name: "Recette J6 — Sectionneurs", version: "2.5", tests: [TLOCAL, T1420] },
      project,
    );
    expect(out).toMatchObject({ slug: "recette-j6-sectionneurs", dryRun: false });
    expect(out.tests.map((t: any) => t.id)).toEqual([TLOCAL, T1420]);
    const dir = join(project, "test-runs", out.slug);
    expect(existsSync(join(dir, "images", T1420, "fig-40.png"))).toBe(true);
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
    expect(run).toMatchObject({ name: "Recette J6 — Sectionneurs", version: "2.5", createdBy: osUser() });
    expect(existsSync(`${dir}.tmp`)).toBe(false);
  });

  it("stays frozen when the test changes later", async () => {
    const { slug } = await call<any>("runs.create", { name: "Frozen", tests: [T1420] }, project);
    const md = join(project, "tests", T1420, "test.md");
    writeFileSync(md, readFileSync(md, "utf8").replace("Choisir Propriétés.", "Choisir autre chose."));
    const t = (await show(slug)).tests[0];
    expect(t.steps[2].fields.Action).toBe("Choisir Propriétés.");
  });

  it("takes a folder, a review state or labels; a dry run writes nothing; two runs of one name get two folders", async () => {
    const dry = await call<any>(
      "runs.create",
      { name: "Traction", folder: "/Traction/Sectionneurs", dryRun: true },
      project,
    );
    expect(dry.tests.map((t: any) => t.id)).toEqual([T1420, TLOCAL]);
    expect(dry.slug).toBeUndefined();
    expect(existsSync(join(project, "test-runs", "traction"))).toBe(false);
    const byReview = await call<any>("runs.create", { name: "Traction", review: ["validated"] }, project);
    expect(byReview.tests.map((t: any) => t.id)).toEqual(["LFRPS12-1398"]);
    const again = await call<any>("runs.create", { name: "Traction", folder: "/" }, project);
    expect(again.slug).toBe("traction-2");
    expect(again.tests).toHaveLength(3);
    await expect(call("runs.create", { name: "None", labels: ["nothing-has-it"] }, project)).rejects.toThrow(
      /No test for this run/,
    );
    await expect(call("runs.create", { name: "X", tests: ["LFRPS12-9"] }, project)).rejects.toThrow(
      /No test LFRPS12-9/,
    );
  });
});

describe("runs.setResult", () => {
  it("marks steps OK / NOK with a note and sets the result, stamped with who and when", async () => {
    const out = await call<any>(
      "runs.setResult",
      {
        run: RUN,
        test: "LFRPS12-1398",
        steps: [{ step: 1, ok: false, note: "Le disjoncteur reste fermé." }],
        status: "problem",
      },
      project,
    );
    expect(out.result).toMatchObject({
      status: "problem",
      steps: [{ ok: false, note: "Le disjoncteur reste fermé." }],
      updatedBy: osUser(),
    });
    expect(existsSync(join(project, "test-runs", RUN, "results", "LFRPS12-1398.json"))).toBe(true);
    const keep = await call<any>(
      "runs.setResult",
      { run: RUN, test: "LFRPS12-1398", steps: [{ step: 1, ok: true }] },
      project,
    );
    expect(keep.result.steps[0]).toEqual({ ok: true, note: "Le disjoncteur reste fermé." });
    expect(keep.result.status).toBe("problem");
  });

  it("asks a reason for blocked and drops it when the test is no longer blocked", async () => {
    await expect(call("runs.setResult", { run: RUN, test: T1420, status: "blocked" }, project)).rejects.toThrow(
      /needs its reason/,
    );
    await call("runs.setResult", { run: RUN, test: T1420, status: "blocked", blockedReason: "TK non câblée" }, project);
    expect(await resultOf(T1420)).toMatchObject({ status: "blocked", blockedReason: "TK non câblée" });
    await call("runs.setResult", { run: RUN, test: T1420, status: "passed" }, project);
    expect((await resultOf(T1420)).blockedReason).toBeUndefined();
  });

  it("finds a test by its Jira key, refuses a test or a step the run does not hold", async () => {
    await expect(call("runs.setResult", { run: RUN, test: "LFRPS12-1", status: "passed" }, project)).rejects.toThrow(
      /No test LFRPS12-1 in the run/,
    );
    await expect(
      call("runs.setResult", { run: RUN, test: TLOCAL, steps: [{ step: 3, ok: true }] }, project),
    ).rejects.toThrow(/Step 3 does not exist/);
  });
});

describe("runs.comment and runs.attach", () => {
  it("adds a comment or a question on a step, and answers a question", async () => {
    const q = await call<any>(
      "runs.comment",
      { run: RUN, test: T1420, kind: "question", step: 2, text: "Le menu doit-il être trié ?" },
      project,
    );
    expect(q.comment).toMatchObject({ kind: "question", step: 2, by: osUser() });
    const a = await call<any>(
      "runs.comment",
      { run: RUN, test: T1420, answers: q.comment.id, text: "Non, dans l'ordre du §5.6.6." },
      project,
    );
    expect(a.comment).toMatchObject({ id: q.comment.id, answer: "Non, dans l'ordre du §5.6.6." });
    expect((await resultOf(T1420)).comments).toHaveLength(1);
    const { runs } = await call<any>("runs.list", {}, project);
    expect(runs[0].openQuestions).toBe(1);
    await expect(call("runs.comment", { run: RUN, test: T1420, text: "  " }, project)).rejects.toThrow(/empty/);
    await expect(
      call("runs.comment", { run: RUN, test: TLOCAL, answers: "c0a1b2c3", text: "x" }, project),
    ).rejects.toThrow(/Only a question/);
  });

  it("copies a screenshot into results/<testId>/ and lists it on the result", async () => {
    const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
    const out = await call<any>(
      "runs.attach",
      { run: RUN, test: TLOCAL, step: 2, dataBase64: png, name: "capture.png" },
      project,
    );
    expect(out.attachment.file).toMatch(/^capture-[0-9a-f]{8}\.png$/);
    expect(out.attachment.step).toBe(2);
    expect(existsSync(join(project, "test-runs", RUN, "results", TLOCAL, out.attachment.file))).toBe(true);
    await expect(
      call("runs.attach", { run: RUN, test: TLOCAL, dataBase64: png, name: "x.exe" }, project),
    ).rejects.toThrow(/not a picture/);
    await expect(call("runs.attach", { run: RUN, test: TLOCAL, file: "relative.png" }, project)).rejects.toThrow(
      /not an absolute path/,
    );
  });
});

describe("runs.remove and Claude's access", () => {
  it("deletes the run's folder and nothing else", async () => {
    const out = await call<any>("runs.remove", { run: "recette-j4-traction" }, project);
    expect(out).toEqual({ run: "recette-j4-traction", name: "Recette J4 — Traction" });
    expect(existsSync(join(project, "test-runs", "recette-j4-traction"))).toBe(false);
    expect(existsSync(join(project, "tests", "LFRPS12-1398", "test.md"))).toBe(true);
  });

  it("lets every Claude run read the runs and none mark a result", () => {
    for (const kind of ["chat", "check", "generate", "fix", "run", "action"] as const) {
      const { allow, deny } = mcpAccess(kind);
      expect(allow).toEqual(expect.arrayContaining(["mcp__testimus__runs_list", "mcp__testimus__runs_show"]));
      for (const w of ["setResult", "comment", "attach", "create", "remove", "export", "import"])
        expect(deny, `${kind} ${w}`).toContain(`mcp__testimus__runs_${w}`);
    }
  });
});
