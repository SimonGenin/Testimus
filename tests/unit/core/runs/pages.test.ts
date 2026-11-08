import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call, fixtureCopy } from "../registry.ts";

const RUN = "recette-j5-sectionneurs";
let project = "";
let out = "";

beforeEach(() => {
  project = fixtureCopy("pages");
  out = join(mkdtempSync(join(tmpdir(), "testimus-pages-")), "pages");
});
afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(join(out, ".."), { recursive: true, force: true });
});

const show = async (p = project, run = RUN) => call<any>("runs.show", { run }, p);
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path: string, v: unknown) => writeFileSync(path, JSON.stringify(v));

describe("runs.export", () => {
  it("writes a folder that runs without Testimus: the page with the run inside, run.json, results, pictures, the server", async () => {
    const r = await call<any>("runs.export", { run: RUN, dir: out }, project);
    expect(r).toMatchObject({ run: RUN, dir: out, tests: 3, results: 2 });
    for (const f of ["index.html", "run.json", "serve.mjs", "start.cmd", "start.sh", "README.md"])
      expect(existsSync(join(out, f)), f).toBe(true);
    expect(existsSync(join(out, "images", "LFRPS12-1420", "fig-40.png"))).toBe(true);
    expect(existsSync(join(out, "results", "local-3f9a12c0.json"))).toBe(true);
    const run = json(join(out, "run.json"));
    expect(run).toMatchObject({ format: "testimus-run-pages/1", slug: RUN, name: "Recette J5 — Sectionneurs" });
    const html = readFileSync(join(out, "index.html"), "utf8");
    const data = JSON.parse(/<script type="application\/json" id="run-data">([^<]*)<\/script>/.exec(html)?.[1] ?? "");
    expect(data.run.slug).toBe(RUN);
    expect(Object.keys(data.results).sort()).toEqual(["LFRPS12-1420", "local-3f9a12c0"]);
    expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
    expect(readFileSync(join(out, "start.cmd"), "utf8")).toContain("\r\n");
  });

  it("leaves the results out when asked, and never writes over a folder that holds something", async () => {
    await call("runs.export", { run: RUN, dir: out, results: false }, project);
    expect(existsSync(join(out, "results"))).toBe(false);
    await expect(call("runs.export", { run: RUN, dir: out }, project)).rejects.toThrow(/is not empty/);
    await expect(call("runs.export", { run: RUN, dir: "relative/dir" }, project)).rejects.toThrow(/absolute path/);
  });
});

describe("runs.import", () => {
  it("brings back what the pages recorded, without loss: results, notes, comments, answers, screenshots", async () => {
    const before = await show();
    await call("runs.export", { run: RUN, dir: out }, project);
    const t1398 = join(out, "results", "LFRPS12-1398.json");
    writeJson(t1398, {
      status: "problem",
      steps: [{ ok: false, note: "Le disjoncteur reste fermé." }],
      comments: [
        { id: "a1b2c3d4", kind: "comment", step: 1, text: "Poste 3.", by: "Paul Martin", at: "2026-11-09T10:00:00Z" },
      ],
      attachments: [{ file: "capture-0a0b0c0d.png", step: 1 }],
      updatedAt: "2026-11-09T10:01:00.000Z",
      updatedBy: "Paul Martin",
    });
    mkdirSync(join(out, "results", "LFRPS12-1398"), { recursive: true });
    writeFileSync(join(out, "results", "LFRPS12-1398", "capture-0a0b0c0d.png"), "png");
    const local = json(join(out, "results", "local-3f9a12c0.json"));
    local.comments[1] = {
      ...local.comments[1],
      answer: "Oui, toujours.",
      answeredBy: "Marie",
      answeredAt: "2026-11-09T11:00:00Z",
    };
    writeJson(join(out, "results", "local-3f9a12c0.json"), local);

    const plan = await call<any>("runs.import", { dir: out, dryRun: true }, project);
    expect(plan).toMatchObject({
      run: RUN,
      creates: false,
      results: 1,
      comments: 1,
      answers: 1,
      attachments: 1,
      conflicts: [],
    });
    expect(await show()).toEqual(before);

    await call("runs.import", { dir: out }, project);
    const after = await show();
    const r = after.tests.find((t: any) => t.id === "LFRPS12-1398").result;
    expect(r).toMatchObject({
      status: "problem",
      steps: [{ ok: false, note: "Le disjoncteur reste fermé." }],
      updatedBy: "Paul Martin",
      attachments: [{ file: "capture-0a0b0c0d.png", step: 1 }],
    });
    expect(r.comments[0]).toMatchObject({ id: "a1b2c3d4", text: "Poste 3.", by: "Paul Martin" });
    expect(existsSync(join(project, "test-runs", RUN, "results", "LFRPS12-1398", "capture-0a0b0c0d.png"))).toBe(true);
    const q = after.tests.find((t: any) => t.id === "local-3f9a12c0").result.comments[1];
    expect(q).toMatchObject({ answer: "Oui, toujours.", answeredBy: "Marie" });
    expect(after.tests[0].result).toEqual(before.tests[0].result);
    expect(after.importedAt).toBeTruthy();

    const again = await call<any>("runs.import", { dir: out, dryRun: true }, project);
    expect(again).toMatchObject({ results: 0, comments: 0, answers: 0, attachments: 0, conflicts: [] });
  });

  it("on a conflict the newer result wins and the older is kept in its history", async () => {
    await call("runs.export", { run: RUN, dir: out }, project);
    const file = join(out, "results", "local-3f9a12c0.json");
    writeJson(file, {
      ...json(file),
      status: "passed",
      steps: [{ ok: true }, { ok: true }],
      updatedAt: "2099-01-01T00:00:00.000Z",
      updatedBy: "Paul",
    });
    const plan = await call<any>("runs.import", { dir: out, dryRun: true }, project);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        test: "local-3f9a12c0",
        kept: "pages",
        here: expect.objectContaining({ status: "problem" }),
      }),
    ]);
    await call("runs.import", { dir: out }, project);
    const r = (await show()).tests.find((t: any) => t.id === "local-3f9a12c0").result;
    expect(r.status).toBe("passed");
    expect(r.history).toEqual([expect.objectContaining({ status: "problem", updatedBy: "tester" })]);

    writeJson(file, { ...json(file), status: "blocked", blockedReason: "x", updatedAt: "2000-01-01T00:00:00.000Z" });
    const older = await call<any>("runs.import", { dir: out, dryRun: true }, project);
    expect(older.conflicts[0]).toMatchObject({ kept: "here" });
    await call("runs.import", { dir: out }, project);
    const kept = (await show()).tests.find((t: any) => t.id === "local-3f9a12c0").result;
    expect(kept.status).toBe("passed");
    expect(kept.history.map((h: any) => h.status)).toEqual(["problem", "blocked"]);
  });

  it("reads the run.json the page saved without a server (results and screenshots inside), and makes a run it does not know", async () => {
    await call("runs.export", { run: RUN, dir: out }, project);
    const saved = join(out, "..", "saved-run.json");
    const run = json(join(out, "run.json"));
    writeJson(saved, {
      ...run,
      slug: "essai-bobigny",
      name: "Essai sur site — Bobigny",
      results: {
        "LFRPS12-1420": {
          status: "blocked",
          blockedReason: "Pas de simulateur",
          steps: [],
          comments: [],
          attachments: [{ file: "capture-11223344.png", data: "data:image/png;base64,iVBORw0KGgo=" }],
          updatedAt: "2026-11-09T09:00:00.000Z",
          updatedBy: "Paul",
        },
      },
    });
    const plan = await call<any>("runs.import", { file: saved, dryRun: true }, project);
    expect(plan).toMatchObject({ run: "essai-bobigny", creates: true, results: 1, attachments: 1 });
    await call("runs.import", { file: saved }, project);
    const made = await show(project, "essai-bobigny");
    expect(made.name).toBe("Essai sur site — Bobigny");
    expect(made.tests).toHaveLength(3);
    expect(made.tests[0].result).toMatchObject({ status: "blocked", blockedReason: "Pas de simulateur" });
    expect(made.tests[0].result.attachments[0]).not.toHaveProperty("data");
    expect(
      existsSync(join(project, "test-runs", "essai-bobigny", "results", "LFRPS12-1420", "capture-11223344.png")),
    ).toBe(true);
  });

  it("refuses what is not a run, and a screenshot name that climbs out of the folder", async () => {
    await expect(call("runs.import", { dir: out, dryRun: true }, project)).rejects.toThrow(/No run.json/);
    await call("runs.export", { run: RUN, dir: out }, project);
    const file = join(out, "results", "LFRPS12-1398.json");
    writeJson(file, {
      status: "passed",
      steps: [{ ok: true }],
      comments: [],
      attachments: [{ file: "../../../evil.png", data: "data:image/png;base64,iVBORw0KGgo=" }],
      updatedAt: "2026-11-09T09:00:00.000Z",
    });
    const plan = await call<any>("runs.import", { dir: out, dryRun: true }, project);
    expect(plan).toMatchObject({ results: 1, attachments: 0 });
    writeFileSync(join(out, "run.json"), "not json");
    await expect(call("runs.import", { dir: out }, project)).rejects.toThrow(/not JSON/);
  });
});

describe("runs.import reads what came from another PC as untrusted", () => {
  it("never follows a link: a screenshot that points elsewhere on this PC, or sits in a linked folder, is left out", async () => {
    await call("runs.export", { run: RUN, dir: out }, project);
    const secret = join(out, "..", "id_rsa");
    writeFileSync(secret, "SECRET-KEY-MATERIAL");
    mkdirSync(join(out, "results", "LFRPS12-1398"), { recursive: true });
    symlinkSync(secret, join(out, "results", "LFRPS12-1398", "capture-1.png"));
    writeJson(join(out, "results", "LFRPS12-1398.json"), {
      status: "passed",
      steps: [{ ok: true }],
      attachments: [{ file: "capture-1.png" }],
      updatedAt: "2026-11-09T10:00:00Z",
    });
    const plan = await call<any>("runs.import", { dir: out, dryRun: true }, project);
    expect(plan).toMatchObject({ results: 1, attachments: 0 });
    await call("runs.import", { dir: out }, project);
    expect(existsSync(join(project, "test-runs", RUN, "results", "LFRPS12-1398", "capture-1.png"))).toBe(false);

    const elsewhere = join(out, "..", "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, "capture-2.png"), "SECRET");
    symlinkSync(elsewhere, join(out, "results", "LFRPS12-1420"));
    writeJson(join(out, "results", "LFRPS12-1420.json"), {
      ...json(join(out, "results", "LFRPS12-1420.json")),
      attachments: [{ file: "capture-2.png" }],
    });
    expect(await call<any>("runs.import", { dir: out, dryRun: true }, project)).toMatchObject({ attachments: 0 });
  });

  it("keeps only fields of the right type: a comment without its time, a bad kind, step or answer cannot break the import or the Run screen", async () => {
    await call("runs.export", { run: RUN, dir: out }, project);
    writeJson(join(out, "results", "LFRPS12-1398.json"), {
      status: "passed",
      steps: [{ ok: true }],
      updatedAt: "2026-11-09T10:00:00Z",
      comments: [
        { id: "x2", text: "other", at: "2026-01-01" },
        { id: "x1", text: "no at" },
        { id: "x3", text: "odd", kind: "nope", step: "9", by: 42, answer: { evil: 1 }, at: "2026-02-01" },
        { id: "x4", text: "too far", kind: "question", step: 7, at: "2026-03-01" },
      ],
      attachments: [{ file: "capture-0a0b0c0d.png", step: "x", data: "data:image/png;base64,iVBORw0KGgo=" }],
      history: [{ foo: 1 }, "nope"],
    });
    const plan = await call<any>("runs.import", { dir: out, dryRun: true }, project);
    expect(plan).toMatchObject({ results: 1, comments: 3, questions: 1, attachments: 1 });
    await call("runs.import", { dir: out }, project);
    const r = (await show()).tests.find((t: any) => t.id === "LFRPS12-1398").result;
    expect(r.comments).toEqual([
      { id: "x1", kind: "comment", text: "no at", by: "", at: "" },
      { id: "x2", kind: "comment", text: "other", by: "", at: "2026-01-01" },
      { id: "x3", kind: "comment", text: "odd", by: "", at: "2026-02-01" },
      { id: "x4", kind: "question", text: "too far", by: "", at: "2026-03-01" },
    ]);
    expect(r.attachments).toEqual([{ file: "capture-0a0b0c0d.png" }]);
    expect(r.openQuestions).toBe(1);
    const hand = join(project, "test-runs", RUN, "results", "LFRPS12-1398.json");
    writeJson(hand, { ...json(hand), history: [{ status: "passed", steps: "x" }, 3] });
    expect((await show()).tests[2].result.history).toEqual([
      { status: "passed", steps: [{ ok: null }], replacedAt: "" },
    ]);
  });
});

describe("runs.import only into the run the pages came from", () => {
  it("refuses a run.json that is not pages of this format", async () => {
    await call("runs.export", { run: RUN, dir: out }, project);
    const run = json(join(out, "run.json"));
    writeJson(join(out, "run.json"), { ...run, format: undefined });
    await expect(call("runs.import", { dir: out, dryRun: true }, project)).rejects.toThrow(
      /not a run exported as pages/,
    );
    writeJson(join(out, "run.json"), { ...run, format: "testimus-run-pages/2" });
    await expect(call("runs.import", { dir: out, dryRun: true }, project)).rejects.toThrow(
      /another version of Testimus/,
    );
  });

  it("refuses pages of another run of the same name, and says how to import them on their own", async () => {
    await call("runs.export", { run: RUN, dir: out }, project);
    const file = join(project, "test-runs", RUN, "run.json");
    writeJson(file, { ...json(file), createdAt: "2026-12-01T08:00:00.000Z" });
    const refused = call("runs.import", { dir: out, dryRun: true }, project);
    await expect(refused).rejects.toThrow(/another run than « Recette J5 — Sectionneurs »/);
    await expect(refused).rejects.toMatchObject({ fix: expect.stringMatching(/--run <new-run>/) });
    const plan = await call<any>("runs.import", { dir: out, run: "recette-j5-bis", dryRun: true }, project);
    expect(plan).toMatchObject({ run: "recette-j5-bis", creates: true });
  });

  it("does not put marks back on steps by their number when a test has another number of steps, and says so", async () => {
    await call("runs.export", { run: RUN, dir: out }, project);
    const run = json(join(out, "run.json"));
    run.tests[2].steps.push({ fields: { Action: "Encore." }, images: [] });
    writeJson(join(out, "run.json"), run);
    writeJson(join(out, "results", "LFRPS12-1398.json"), {
      status: "problem",
      steps: [{ ok: true }, { ok: false, note: "Le second pas." }],
      comments: [{ id: "c9", kind: "comment", step: 2, text: "Au pas 2.", by: "Paul", at: "2026-11-09T10:00:00Z" }],
      updatedAt: "2026-11-09T10:00:00Z",
    });
    const plan = await call<any>("runs.import", { dir: out, dryRun: true }, project);
    expect(plan.stepsChanged).toEqual([{ test: "LFRPS12-1398", summary: expect.any(String), here: 1, pages: 2 }]);
    await call("runs.import", { dir: out }, project);
    const r = (await show()).tests[2].result;
    expect(r).toMatchObject({ status: "problem", steps: [{ ok: null }] });
    expect(r.comments[0]).not.toHaveProperty("step");
  });

  it("a conflict decided « kept: here » does not come back on the next import: there is nothing to import", async () => {
    await call("runs.export", { run: RUN, dir: out }, project);
    const file = join(out, "results", "local-3f9a12c0.json");
    writeJson(file, { ...json(file), status: "blocked", blockedReason: "x", updatedAt: "2000-01-01T00:00:00.000Z" });
    const first = await call<any>("runs.import", { dir: out, dryRun: true }, project);
    expect(first.conflicts).toEqual([expect.objectContaining({ kept: "here" })]);
    await call("runs.import", { dir: out }, project);
    const again = await call<any>("runs.import", { dir: out, dryRun: true }, project);
    expect(again).toMatchObject({ results: 0, comments: 0, questions: 0, answers: 0, attachments: 0, conflicts: [] });
  });
});
