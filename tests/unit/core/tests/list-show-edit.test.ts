import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { commands } from "../../../../src/core/commands/tests.ts";
import type { LocalTestRef, Test } from "../../../../src/core/types.ts";

const FIXTURE = resolve(import.meta.dirname, "..", "..", "..", "fixtures", "project");
let P = "";

beforeEach(() => {
  P = mkdtempSync(join(tmpdir(), "testimus-cmd-"));
  cpSync(FIXTURE, P, { recursive: true });
});

const run = async <T>(name: string, input: unknown, project: string | null = P): Promise<T> => {
  const c = commands.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return (await c.run(quietCtx(project), c.input.parse(input) as never)) as T;
};

type Show = {
  test: Test;
  warnings: string[];
  md: string;
  remote: Test | null;
  remoteMd: string | null;
  sync: string;
  findings: unknown;
  check: unknown;
};
const md = (id: string) => readFileSync(join(P, "tests", id, "test.md"), "utf8");

test("every input field is described and the id is positional", () => {
  for (const c of commands) {
    const shape = (c.input as unknown as { shape: Record<string, { description?: string }> }).shape;
    for (const [k, v] of Object.entries(shape)) expect(v.description, `${c.name} ${k}`).toBeTruthy();
    if ("id" in shape) expect(c.positional?.[0]).toBe("id");
  }
  expect(commands.map((c) => c.name).sort()).toEqual([
    "tests.clone",
    "tests.create",
    "tests.edit",
    "tests.folds",
    "tests.list",
    "tests.remove",
    "tests.removeImage",
    "tests.restore",
    "tests.save",
    "tests.setFolds",
    "tests.show",
  ]);
});

test("tests.list lists the fixture and filters by folder, review and text", async () => {
  const all = await run<LocalTestRef[]>("tests.list", {});
  expect(all.map((t) => t.id)).toEqual(["LFRPS12-1398", "LFRPS12-1420", "local-3f9a12c0"]);
  const ids = async (input: unknown) => (await run<LocalTestRef[]>("tests.list", input)).map((t) => t.id);
  expect(await ids({ folder: "/Traction/Sectionneurs" })).toEqual(["LFRPS12-1420", "local-3f9a12c0"]);
  expect(await ids({ folder: "/Traction/" })).toHaveLength(3);
  expect(await ids({ folder: "/Traction/Section" })).toEqual([]);
  expect(await ids({ review: "validated" })).toEqual(["LFRPS12-1398"]);
  expect(await ids({ text: "AVEC tk" })).toEqual(["local-3f9a12c0"]);
  expect(await ids({ text: "1420" })).toEqual(["LFRPS12-1420"]);
  await expect(run("tests.list", {}, null)).rejects.toThrow(/No project/);
});

test("tests.show returns the test, its raw text, the remote copy, sync and findings", async () => {
  const s = await run<Show>("tests.show", { id: "LFRPS12-1420" });
  expect(s.md).toBe(md("LFRPS12-1420"));
  expect(s.test.steps).toHaveLength(5);
  expect(s.warnings).toEqual([]);
  expect(s.remote?.steps[1].fields["Expected Result"]).toBe("Le menu propose les commandes du sectionneur.");
  expect(s.remoteMd).toContain("review: draft");
  expect(s.sync).toBe("modified");
  expect(s.findings).toEqual({ errors: 2, warnings: 2, infos: 0, stale: false });
  expect((s.check as { findings: unknown[] }).findings).toHaveLength(4);

  const l = await run<Show>("tests.show", { id: "local-3f9a12c0" });
  expect(l).toMatchObject({ remote: null, remoteMd: null, sync: "local", findings: null, check: null });
  await expect(run("tests.show", { id: "LFRPS12-9" })).rejects.toThrow(/No test LFRPS12-9/);
  await expect(run("tests.show", { id: "../project.json" })).rejects.toThrow(/not a test id/);
});

test("tests.show reports a heading that is not a field of xray.json", async () => {
  const { id } = await run<{ id: string }>("tests.create", {});
  await run("tests.edit", { id, steps: [{ op: "set", step: 1, field: "Commentaire", value: "x" }] });
  expect((await run<Show>("tests.show", { id })).warnings).toEqual([
    'Step 1: "### Commentaire" is not a step field of this project (xray.json)',
  ]);
});

test("tests.create writes a draft local test for the project's Jira key", async () => {
  const { id } = await run<{ id: string }>("tests.create", {
    summary: "Nouveau",
    folder: "/Traction",
    labels: ["a"],
    covers: ["LFRPS12-880"],
    description: "desc",
  });
  expect(id).toMatch(/^local-[0-9a-f]{8}$/);
  const s = await run<Show>("tests.show", { id });
  expect(s.test).toMatchObject({
    project: "LFRPS12",
    summary: "Nouveau",
    folder: "/Traction",
    labels: ["a"],
    covers: ["LFRPS12-880"],
    description: "desc",
    review: "draft",
  });
  expect(s.test.steps).toHaveLength(1);
  expect(s.sync).toBe("local");
});

test("tests.edit patches the header and applies step operations in order", async () => {
  const r = await run<LocalTestRef>("tests.edit", {
    id: "local-3f9a12c0",
    summary: "Sectionneur avec TK",
    labels: ["x", "y"],
    steps: [
      { op: "set", step: 2, field: "Expected", value: "Seul Propriétés est proposé." },
      { op: "set", step: 2, field: "Data", value: "TK manœuvré" },
      {
        op: "add",
        fields: { Exigence: "EXI_MOP_SPF_511_A_1680", Action: "Choisir Propriétés." },
        sources: ['SOSIE_211_D401-1_3#req:EXI_MOP_SPF_511_A_1680 "La fenêtre Propriétés"'],
      },
      { op: "add", at: 1, fields: { action: "Se connecter." } },
      { op: "move", step: 1, to: 4 },
      { op: "sources", step: 2, sources: ['SOSIE_211_D401-1_3#§5.6.6 "Selon le type de sectionneur"'] },
    ],
  });
  expect(r).toMatchObject({ summary: "Sectionneur avec TK", stepCount: 4, review: "to-fix" });
  const { test: t } = await run<Show>("tests.show", { id: "local-3f9a12c0" });
  expect(t.labels).toEqual(["x", "y"]);
  expect(t.steps.map((s) => s.fields.Action)).toEqual([
    "Ouvrir la vue de traction et repérer un sectionneur avec TK.",
    "Clic droit sur le sectionneur avec TK.",
    "Choisir Propriétés.",
    "Se connecter.",
  ]);
  expect(t.steps[1].fields).toEqual({
    Action: "Clic droit sur le sectionneur avec TK.",
    "Expected Result": "Seul Propriétés est proposé.",
    Exigence: "EXI_MOP_SPF_511_A_1670",
    Data: "TK manœuvré",
  });
  expect(t.steps[1].sources).toEqual([
    { docId: "SOSIE_211_D401-1_3", anchor: "§5.6.6", quote: "Selon le type de sectionneur" },
  ]);
  const text = md("local-3f9a12c0");
  const s2 = text.slice(text.indexOf("## Step 2"), text.indexOf("## Step 3"));
  expect(s2.indexOf("### Action")).toBeLessThan(s2.indexOf("### Data"));
  expect(s2.indexOf("### Data")).toBeLessThan(s2.indexOf("### Expected Result"));
  expect(s2.indexOf("### Expected Result")).toBeLessThan(s2.indexOf("### Exigence"));
  expect(s2.indexOf("### Exigence")).toBeLessThan(s2.indexOf("### Sources"));

  await run("tests.edit", { id: "local-3f9a12c0", steps: [{ op: "remove", step: 4 }] });
  expect((await run<Show>("tests.show", { id: "local-3f9a12c0" })).test.steps).toHaveLength(3);
});

test("tests.edit refuses a missing step or a malformed source and leaves the file alone", async () => {
  const before = md("local-3f9a12c0");
  await expect(
    run("tests.edit", { id: "local-3f9a12c0", summary: "x", steps: [{ op: "remove", step: 9 }] }),
  ).rejects.toThrow(/Step 9 does not exist/);
  await expect(
    run("tests.edit", { id: "local-3f9a12c0", steps: [{ op: "sources", step: 1, sources: ["DOC#§1"] }] }),
  ).rejects.toThrow(/not docId#anchor "quote"/);
  expect(md("local-3f9a12c0")).toBe(before);
});

test("an edit that changes nothing keeps the fixture bytes", async () => {
  const before = md("LFRPS12-1420");
  await run("tests.edit", { id: "LFRPS12-1420" });
  expect(md("LFRPS12-1420")).toBe(before);
});

test("tests.save writes the whole test as the editor holds it", async () => {
  const s = await run<Show>("tests.show", { id: "LFRPS12-1398" });
  const r = await run<LocalTestRef>("tests.save", { id: "LFRPS12-1398", test: s.test });
  expect(r).toMatchObject({ sync: "synced", review: "validated" });
  expect(md("LFRPS12-1398")).toBe(s.md);

  const edited = structuredClone(s.test);
  edited.steps[0].fields["Expected Result"] = "Le menu propose Ouvrir et Fermer.";
  edited.steps.push({ fields: { Action: "Ouvrir." }, sources: [], images: [] });
  const r2 = await run<LocalTestRef>("tests.save", { id: "LFRPS12-1398", test: edited });
  expect(r2).toMatchObject({ sync: "modified", stepCount: 2 });
  await expect(run("tests.save", { id: "LFRPS12-5", test: s.test })).rejects.toThrow(/No test/);
});

test("tests.clone copies a test with its images, tests.remove deletes it", async () => {
  const { id } = await run<{ id: string }>("tests.clone", { id: "LFRPS12-1420" });
  const s = await run<Show>("tests.show", { id });
  expect(s.test).toMatchObject({ key: undefined, clonedFrom: "LFRPS12-1420", review: "draft" });
  expect(existsSync(join(P, "tests", id, "images/fig-40.png"))).toBe(true);
  expect(await run("tests.remove", { id })).toEqual({ id, removed: true });
  expect(existsSync(join(P, "tests", id))).toBe(false);
  await expect(run("tests.remove", { id })).rejects.toThrow(/No test/);
});
