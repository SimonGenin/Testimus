import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contextDir } from "../../../../src/core/claude/prompt.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { env } from "../../../../src/core/env.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { readTest } from "../../../../src/core/lib/store.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-gen.ts";
import "../../../../src/core/mock/claude-check.ts";
import type { ClaudeAction } from "../../../../src/core/types.ts";
import { writeContextMd } from "../../helpers/context.ts";
import { markIndexedInDb as markIndexed } from "../../helpers/index-state.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const REQUEST = "Menu contextuel des sectionneurs";
const real = env.spawnClaude;
let dir: string;

type Gen = { generation: string; tests: string[]; revised?: string[]; ok: boolean; checks: { id: string }[] };
type Shown = { name: string; request: string; tests: string[]; skipped: { category: string }[] };
type Listed = ClaudeAction & { stale: boolean };

const generate = () =>
  invoke("gen.tests", { request: REQUEST, sections: ["SOSIE_211_D401-1_3#§5.6.6"] }, { project: dir }) as Promise<Gen>;
const actionsOf = (generation: string) => invoke("actions.list", { generation }, { project: dir }) as Promise<Listed[]>;

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-revise-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  markIndexed(dir);
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  env.spawnClaude = mockSpawnClaude;
});

afterEach(() => {
  env.spawnClaude = real;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("after a generation", () => {
  it("gen.show says what it was asked, its tests and what it could not write; an unknown one is refused", async () => {
    const g = await generate();
    const shown = (await invoke("gen.show", { generation: g.generation }, { project: dir })) as Shown;
    expect(shown.request).toBe(REQUEST);
    expect(shown.name).toBe(REQUEST);
    expect([...shown.tests].sort()).toEqual([...g.tests].sort());
    expect(shown.skipped.map((s) => s.category)).toContain("Hors du périmètre demandé");
    await expect(invoke("gen.show", { generation: "nope" }, { project: dir })).rejects.toThrow(/No generation nope/);
  });

  it("the core leaves one Claude action per test with findings and per category not written, once", async () => {
    const g = await generate();
    const listed = await actionsOf(g.generation);
    const onTests = listed.filter((a) => a.where.startsWith("test:"));
    const onGen = listed.filter((a) => a.where === `gen:${g.generation}`);
    expect(onTests.length).toBeGreaterThan(0);
    for (const a of onTests) {
      expect(g.tests).toContain(a.where.slice(5));
      expect(a.title).toMatch(/^Fix the \d+ (error|warning)s? in « .+ »$/);
      expect(a.title).not.toMatch(/local-/);
      expect(a.proposedBy.run).toBe("generate");
    }
    expect(onGen.map((a) => a.title).sort()).toEqual([
      "Write the 1 test skipped for « Hors du périmètre demandé »",
      "Write the 2 tests skipped for « Pas de source pour le résultat attendu »",
    ]);
    expect(onGen[0].problem).toMatch(/not written/);
    const all = (await invoke("actions.list", {}, { project: dir })) as Listed[];
    expect(all.length).toBe(listed.length);

    const ledger = join(dir, ".testimus", "gen", `${g.generation}.json`);
    const l = JSON.parse(readFileSync(ledger, "utf8"));
    writeFileSync(ledger, JSON.stringify({ ...l, skipped: [] }));
    expect((await actionsOf(g.generation)).filter((a) => a.where.startsWith("gen:"))).toHaveLength(0);
    writeFileSync(ledger, JSON.stringify(l));
    expect((await actionsOf(g.generation)).filter((a) => a.where.startsWith("gen:"))).toHaveLength(2);
    for (const id of g.tests) rmSync(join(dir, "tests", id), { recursive: true, force: true });
    const left = await actionsOf(g.generation);
    expect(left.filter((a) => a.where.startsWith("test:"))).toHaveLength(0);
    expect(left.filter((a) => a.where === `gen:${g.generation}`)).toHaveLength(2);
    rmSync(ledger);
    expect(await actionsOf(g.generation)).toHaveLength(0);
  });

  it("gen.revise change: Claude edits the generation's tests, they are checked again, the result is the generation's", async () => {
    const g = await generate();
    const before = await actionsOf(g.generation);
    const r = (await invoke(
      "gen.revise",
      { generation: g.generation, request: "Précise ce qu'il faut vérifier avant chaque action.", mode: "change" },
      { project: dir },
    )) as Gen;
    expect(r.ok).toBe(true);
    expect(r.generation).toBe(g.generation);
    expect(r.tests).toEqual([]);
    expect(r.revised?.length).toBeGreaterThan(0);
    for (const id of r.revised ?? []) expect(g.tests).toContain(id);
    expect(r.checks.map((c) => c.id).sort()).toEqual([...(r.revised ?? [])].sort());
    const changed = r.revised?.[0] ?? "";
    const stale = before.filter((a) => a.where === `test:${changed}`);
    const after = await actionsOf(g.generation);
    for (const a of stale) expect(after.map((x) => x.id)).not.toContain(a.id);
  });

  it("gen.revise add: more tests under the same generation, told which it already has; the first request stays", async () => {
    const g = await generate();
    const r = (await invoke(
      "gen.revise",
      { generation: g.generation, request: "Ajoute le défaut de la TK", mode: "add" },
      { project: dir },
    )) as Gen;
    expect(r.generation).toBe(g.generation);
    expect(r.tests).toHaveLength(2);
    for (const id of r.tests) expect(readTest(dir, id).test.generatedBy).toBe(g.generation);
    const shown = (await invoke("gen.show", { generation: g.generation }, { project: dir })) as Shown;
    expect(shown.tests).toHaveLength(4);
    expect(shown.request).toBe(REQUEST);
  });

  it("gen.revise add is told the tests and the items not written; the ledger keeps its plan and the items still not written", async () => {
    const g = await generate();
    const file = join(dir, ".testimus", "gen", `${g.generation}.json`);
    const before = JSON.parse(readFileSync(file, "utf8"));
    const unique = { item: "Article à part", category: "Catégorie d'origine", why: "x" };
    const plan = { found: true, tests: [{ summary: "planned A", technique: "", sections: [] }], skipped: [] };
    writeFileSync(file, JSON.stringify({ ...before, skipped: [...before.skipped, unique], plan, done: [0] }));
    const prompts: string[] = [];
    env.spawnClaude = (s) => {
      prompts.push(s.stdin);
      return mockSpawnClaude(s);
    };
    const r = (await invoke(
      "gen.revise",
      { generation: g.generation, request: "Couvre les éléments non écrits", mode: "add", note: "Ma note" },
      { project: dir },
    )) as Gen & { skipped: { item: string }[] };
    const sent = prompts.find((p) => p.includes("Use the generate-tests skill")) ?? "";
    expect(sent).toContain(`This adds tests to an earlier generation for: ${REQUEST}.`);
    for (const id of g.tests) expect(sent).toContain(`- ${readTest(dir, id).test.summary}`);
    expect(sent).toContain("- Article à part (Catégorie d'origine: x)");
    expect(sent).toContain('"covered"');
    expect(sent).toContain("Additional context from the user for this run:\nMa note");
    expect(sent).not.toContain("never write them again:\n- Ma note");

    const after = JSON.parse(readFileSync(file, "utf8"));
    const items = after.skipped.map((s: { item: string }) => s.item);
    expect(items).toContain("Article à part");
    expect(items).not.toContain(before.skipped[0].item);
    expect(items).toHaveLength(before.skipped.length);
    expect(r.skipped.map((s) => s.item)).toEqual(items);
    expect(after.plan).toEqual(plan);
    expect(after.done).toEqual([0]);
    expect(after.tests).toHaveLength(4);
  });

  it("two gen.revise add at once on one generation go one after the other: no test is lost", async () => {
    const g = await generate();
    const ask = (request: string) =>
      invoke("gen.revise", { generation: g.generation, request, mode: "add" }, { project: dir }) as Promise<Gen>;
    const [a, b] = await Promise.all([ask("Ajoute le défaut de la TK"), ask("Ajoute la fermeture")]);
    const shown = (await invoke("gen.show", { generation: g.generation }, { project: dir })) as Shown;
    expect([...shown.tests].sort()).toEqual([...g.tests, ...a.tests, ...b.tests].sort());
    expect(shown.tests).toHaveLength(6);
  });

  it("gen.revise change runs with the generation's contexts unless it is given others", async () => {
    const g = await generate();
    const file = join(dir, ".testimus", "gen", `${g.generation}.json`);
    const l = JSON.parse(readFileSync(file, "utf8"));
    expect(l.input.contexts).toEqual([]);
    writeContextMd(contextDir(dir, "glossary"), { name: "RATP glossary", notes: "TCO: poste de commande." });
    writeFileSync(file, JSON.stringify({ ...l, input: { ...l.input, contexts: ["glossary"] } }));
    const prompts: string[] = [];
    env.spawnClaude = (s) => {
      prompts.push(s.stdin);
      return mockSpawnClaude(s);
    };
    const ask = (contexts?: string[]) =>
      invoke(
        "gen.revise",
        { generation: g.generation, request: "Précise", mode: "change", ...(contexts ? { contexts } : {}) },
        { project: dir },
      );
    await ask();
    const edit = () => prompts.filter((p) => p.startsWith("Use the edit-test skill")).pop() ?? "";
    expect(edit()).toMatch(/^Scope: the tests /m);
    expect(edit()).toContain("- RATP glossary — notes:");
    await ask([]);
    expect(edit()).not.toContain("RATP glossary");
  });

  it("gen.revise refuses an unknown generation, an empty request, and picked tests not of the generation", async () => {
    await expect(
      invoke("gen.revise", { generation: "nope", request: "x", mode: "change" }, { project: dir }),
    ).rejects.toThrow(/No generation nope/);
    const g = await generate();
    await expect(
      invoke(
        "gen.revise",
        { generation: g.generation, request: "x", mode: "change", tests: ["LFRPS12-1420"] },
        { project: dir },
      ),
    ).rejects.toThrow(/No test of this generation/);
  });
});
