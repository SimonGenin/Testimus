import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCommands } from "../../../../src/core/claude/access.ts";
import { BUILT } from "../../../../src/core/claude/catalog.ts";
import { given, type Piece } from "../../../../src/core/claude/given.ts";
import { contextDir } from "../../../../src/core/claude/prompt.ts";
import { readProject, writeProject } from "../../../../src/core/lib/project.ts";
import { templateDir } from "../../../../src/core/lib/shipped.ts";
import { writeContextMd } from "../../helpers/context.ts";
import { call } from "../registry.ts";
import { dir, seen } from "./run-fakes.ts";

// ponytail: claude.preview is what the Context dialog of a Claude block shows before the request is sent — it must
// list what the run itself would be given, so each case compares it with given(), the function the runs call

type Preview = { use: string; kind: string; name: string; answers: string; pieces: Piece[] };

const DOC = "SOSIE_211_D401-1_3";
const TEST = "LFRPS12-1420";

function project(): string {
  cpSync(join(templateDir(), ".claude"), join(dir, ".claude"), { recursive: true });
  cpSync(join(templateDir(), "CLAUDE.md"), join(dir, "CLAUDE.md"));
  writeContextMd(contextDir(dir, "glossary"), { name: "RATP glossary", notes: "TCO: poste de commande." });
  writeContextMd(contextDir(dir, "style"), { name: "House style", notes: "One gesture per step." });
  return dir;
}

const preview = (input: Record<string, unknown>) => call<Preview>("claude.preview", input, dir);
const piece = (p: Preview, id: string) => p.pieces.find((x) => x.id === id);

function generation(id: string, input: Record<string, unknown>) {
  mkdirSync(join(dir, ".testimus", "gen"), { recursive: true });
  writeFileSync(
    join(dir, ".testimus", "gen", `${id}.json`),
    JSON.stringify({
      at: "2026-11-01T10:00:00.000Z",
      input,
      runId: "run-1",
      tests: [TEST],
      consulted: [],
      searched: [],
    }),
  );
}

describe("claude.preview: a request before it is sent, piece by piece", () => {
  it("the instruction, the skill it names, the project rules, the tools of that kind — locked — then what goes with the run", async () => {
    project();
    const p = await preview({ use: "check", scope: { kind: "test", testId: TEST } });
    const template = BUILT.find((t) => t.id === "check");
    expect(p).toMatchObject({ use: "check", kind: "check", name: template?.name, answers: template?.answers });
    expect(p.pieces.slice(0, 4).map((x) => [x.id, x.kind, x.how, x.locked, x.on])).toEqual([
      ["instruction", "instruction", "inline", true, true],
      ["skill:check-test", "skill", "auto", true, true],
      ["rules", "rules", "auto", true, true],
      ["tools", "tools", "auto", true, true],
    ]);
    expect(piece(p, "instruction")).toMatchObject({ name: template?.name, text: template?.text() });
    expect(piece(p, "skill:check-test")).toMatchObject({
      name: "Check test",
      path: ".claude/skills/check-test/SKILL.md",
    });
    expect(piece(p, "skill:check-test")?.text).toMatch(/^---\nname: check-test/);
    expect(piece(p, "rules")).toMatchObject({ name: "Project rules", path: "CLAUDE.md" });
    const tools = runCommands("check").map((n) => n.replace(".", "_"));
    expect(piece(p, "tools")).toMatchObject({
      name: `${tools.length} tools of the app`,
      detail: ["Read", "Glob", "Grep", "Skill", ...tools].join(", "),
      chars: 0,
    });
    expect(p.pieces.slice(4)).toEqual(given(dir, "check", { kind: "test", testId: TEST }).pieces);
    expect(piece(p, `docnote:${DOC}`)).toMatchObject({ on: true, how: "inline", locked: false });
    expect(seen).toEqual([]);
  });

  it("what the user picks for the run shows: a context chosen, another and a document left out, the note", async () => {
    project();
    const pick = {
      contexts: ["style"],
      without: [`doc:${DOC}`, "context:glossary"],
      note: "Réponds court.",
      conversation: "Q: Quel menu ?",
    };
    const p = await preview({ use: "ask-test", scope: { kind: "test", testId: TEST }, ...pick });
    expect(p.kind).toBe("run");
    expect(p.pieces.slice(4)).toEqual(given(dir, "run", { kind: "test", testId: TEST }, pick).pieces);
    expect(piece(p, "skill:edit-test")?.locked).toBe(true);
    expect(piece(p, "context:style")).toMatchObject({ on: true, why: "Chosen for this run", locked: false });
    expect(piece(p, "context:glossary")).toMatchObject({ on: false });
    expect(piece(p, `doc:${DOC}`)).toMatchObject({ on: false, locked: false });
    expect(piece(p, `docnote:${DOC}`)?.on).toBe(false);
    expect(piece(p, "note")).toMatchObject({ on: true, locked: true, text: "Réponds court." });
    expect(piece(p, "conversation")).toMatchObject({ on: true, locked: true });
  });

  it("without a scope the project's defaults go with it; a generation's documents and sections are what it is about", async () => {
    project();
    const p0 = readProject(dir);
    writeProject(dir, { ...p0, claude: { ...p0.claude, contexts: ["glossary"] } });
    const plain = await preview({ use: "chat" });
    expect(plain.pieces.slice(-given(dir, "chat", { kind: "none" }).pieces.length)).toEqual(
      given(dir, "chat", { kind: "none" }).pieces,
    );
    expect(piece(plain, "context:glossary")).toMatchObject({ on: true, why: "A default of the project" });
    expect(piece(plain, `docnote:${DOC}`)).toMatchObject({ locked: true, how: "search" });

    const gen = await preview({ use: "generate", sections: [`${DOC}#§5.6.6`], docs: ["SOSIE_211_D401-1_4"] });
    expect(gen.kind).toBe("generate");
    expect(gen.pieces.map((x) => x.id)).toEqual(
      expect.arrayContaining(["skill:generate-tests", "skill:plan-tests", `doc:${DOC}`, `docnote:${DOC}`]),
    );
    expect(piece(gen, `docnote:${DOC}`)).toMatchObject({
      locked: false,
      how: "inline",
      why: "The run is about this document",
    });
    expect(
      gen.pieces
        .filter((x) => x.kind === "document")
        .slice(0, 2)
        .map((x) => x.why),
    ).toEqual(["A document of this run", "A document of this run"]);
  });

  it("a run that only reads pictures has no tool of the app and no document to search", async () => {
    project();
    const p = await preview({ use: "figures", scope: { kind: "doc", docId: DOC } });
    expect(p.kind).toBe("figures");
    expect(piece(p, "tools")).toMatchObject({ name: "0 tools of the app", detail: "Read" });
    expect(p.pieces.some((x) => x.kind === "document" || x.kind === "skill" || x.kind === "overview")).toBe(false);
    expect(piece(p, `docnote:${DOC}`)?.on).toBe(true);
  });

  it("refuses an id no run sends, and names the ones that do", async () => {
    project();
    for (const use of ["nope", "given", "sign-in", "skill:check-test"]) {
      const refused = preview({ use });
      await expect(refused).rejects.toThrow(`No run sends « ${use} ».`);
      await expect(refused).rejects.toMatchObject({
        fix: expect.stringContaining("generate, generate-review, generate-planned,"),
      });
    }
  });

  it("a request on a generation takes the contexts that generation ran with, unless the input gives its own", async () => {
    project();
    generation("generate-1", { request: "Le sectionneur", sections: [`${DOC}#§5.6.6`], contexts: ["glossary"] });
    const ask = { use: "ask-tests", scope: { kind: "tests", testIds: [TEST, "LFRPS12-1398"] } };
    const base = await preview(ask);
    expect(piece(base, "context:glossary")?.on).toBe(false);

    const ran = await preview({ ...ask, generation: "generate-1" });
    expect(piece(ran, "context:glossary")).toMatchObject({ on: true, why: "Chosen for this run" });
    expect(piece(ran, "context:style")?.on).toBe(false);

    const own = await preview({ ...ask, generation: "generate-1", contexts: [] });
    expect(piece(own, "context:glossary")?.on).toBe(false);
    const other = await preview({ ...ask, generation: "generate-1", contexts: ["style"] });
    expect(piece(other, "context:style")?.on).toBe(true);
    expect(piece(other, "context:glossary")?.on).toBe(false);

    const unknown = await preview({ ...ask, generation: "generate-nope" });
    expect(unknown).toEqual(base);
  });

  it("adding tests to a generation is about the documents it had in scope, unless the input names others", async () => {
    project();
    generation("generate-2", { request: "Le sectionneur", sections: [`${DOC}#§5.6.6`], contexts: [] });
    const about = (p: Preview) => p.pieces.filter((x) => x.why === "A document of this run").map((x) => x.id);
    expect(about(await preview({ use: "generate-add" }))).toEqual([]);
    expect(about(await preview({ use: "generate-add", generation: "generate-2" }))).toEqual([`doc:${DOC}`]);
    expect(
      about(await preview({ use: "generate-add", generation: "generate-2", docs: ["SOSIE_211_D401-1_4"] })),
    ).toEqual(["doc:SOSIE_211_D401-1_4"]);
  });
});
