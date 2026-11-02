import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseProposal } from "../../src/core/claude/traces.ts";
import { invoke } from "../../src/core/commands/index.ts";
import { type ClaudeSpawn, env } from "../../src/core/env.ts";
import { mechanicalCheck, requirementFieldOf } from "../../src/core/lib/check.ts";
import { DEFAULT_SETTINGS, readProject, writeSettings, writeXray } from "../../src/core/lib/project.ts";
import { projectTraces, scanTrace, traceGuidance } from "../../src/core/lib/traces.ts";
import { mockSpawnClaude } from "../../src/core/mock/claude.ts";
import type { TraceCoverage } from "../../src/core/types.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/project/", import.meta.url));
const real = env.spawnClaude;
let calls: ClaudeSpawn[] = [];

function copyFixture(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "testimus-traces-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

// a project with documents but nothing about requirements: no matrix, no csv, no Exigence column, no req anchor
function plainProject(): string {
  const dir = copyFixture();
  rmSync(join(dir, "requirements"), { recursive: true, force: true });
  writeXray(dir, {
    fields: [
      { id: "action", name: "Action", type: "text", builtin: true },
      { id: "result", name: "Expected Result", type: "text", builtin: true },
    ],
    prefs: { order: [], collapsed: [], hidden: [] },
  });
  for (const d of ["SOSIE_211_D401-1_3", "SOSIE_211_D401-1_4"]) {
    const f = join(dir, "docs", d, "doc.md");
    writeFileSync(
      f,
      readFileSync(f, "utf8")
        .replace(/<!-- req [^>]*-->\n?/g, "")
        .replace(/EXI_\w+ : /g, ""),
      "utf8",
    );
  }
  return dir;
}

const run = (dir: string, name: string, input: unknown = {}) => invoke(name, input, { project: dir, wait: true });

beforeEach(() => {
  calls = [];
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
});
afterEach(() => {
  env.spawnClaude = real;
});

describe("tracked ids", () => {
  it("keeps a project from before tracked ids tracking its requirements, detected", async () => {
    const dir = copyFixture();
    const list = (await run(dir, "traces.list")) as { id: string; field: string; origin: string; found: number }[];
    expect(list).toEqual([
      expect.objectContaining({
        id: "requirement",
        field: "Exigence",
        origin: "detected",
        column: "in-xray",
        found: 5,
      }),
    ]);
    expect(readProject(dir).traces).toBeUndefined();
  });

  it("tracks nothing in a project whose documents and Xray have no requirement", async () => {
    const dir = plainProject();
    expect(await run(dir, "traces.list")).toEqual([]);
    expect(traceGuidance(dir)).toEqual([]);
  });

  it("finds ids with their document, section and line, and refuses a pattern that matches nothing in particular", () => {
    const dir = copyFixture();
    const scan = scanTrace(dir, [String.raw`\bFigure \d+`]);
    expect(scan).toMatchObject({ distinct: 1, total: 2, docs: [{ doc: "SOSIE_211_D401-1_3", count: 2, distinct: 1 }] });
    expect(scan.items[0]).toMatchObject({ id: "Figure 40", doc: "SOSIE_211_D401-1_3", anchor: "§5.6.6" });
    expect(scan.items[0].context).toContain("symbole de la Figure 40");
    expect(() => scanTrace(dir, ["a*"])).toThrow(/matches empty text/);
    expect(() => scanTrace(dir, ["(unclosed"])).toThrow(/Not a valid pattern/);
  });

  it("gives a requirement its requirements.csv text, and counts ids only where the text says them", () => {
    const dir = copyFixture();
    const scan = scanTrace(dir, [String.raw`\bEXI_[A-Z0-9_]*[A-Z0-9]`], { csv: true });
    expect(scan.distinct).toBe(5);
    expect(scan.total).toBe(5);
    expect(scan.items.find((i) => i.id === "EXI_MOP_SPF_511_A_1670")?.context).toMatch(/^Le menu contextuel/);
  });

  it("saves a new kind, writes what was detected first, and keeps the requirement keys in step", async () => {
    const dir = copyFixture();
    await run(dir, "traces.save", { label: "Figure", patterns: [String.raw`\bFigure \d+`], field: "Figure" });
    const p = readProject(dir);
    expect(p.traces?.map((t) => t.id)).toEqual(["requirement", "figure"]);
    const views = (await run(dir, "traces.list")) as { id: string; origin: string; column: string }[];
    expect(views.map((v) => [v.id, v.origin, v.column])).toEqual([
      ["requirement", "declared", "in-xray"],
      ["figure", "declared", "local"],
    ]);
    await run(dir, "traces.save", {
      id: "requirement",
      label: "Exigence",
      patterns: [String.raw`\bEXI_[A-Z0-9_]*[A-Z0-9]`, String.raw`\bEXI STB F-\d+`],
      field: "Exigence",
    });
    expect(readProject(dir)).toMatchObject({
      requirementField: "Exigence",
      requirementPatterns: [String.raw`\bEXI STB F-\d+`],
    });
    await run(dir, "traces.remove", { id: "figure" });
    expect(projectTraces(dir)).toMatchObject({ declared: true, traces: [{ id: "requirement", label: "Exigence" }] });
    await run(dir, "traces.remove", { id: "requirement" });
    expect(projectTraces(dir)).toEqual({ declared: true, traces: [] });
  });

  it("refuses a standard column, a column another kind holds and an empty pattern list", async () => {
    const dir = copyFixture();
    await expect(run(dir, "traces.save", { label: "X", patterns: ["X-\\d+"], field: "Action" })).rejects.toThrow(
      /standard step field/,
    );
    await expect(run(dir, "traces.save", { label: "X", patterns: ["X-\\d+"], field: "exigence" })).rejects.toThrow(
      /already holds/,
    );
    await expect(run(dir, "traces.save", { label: "X", patterns: [], field: "X" })).rejects.toThrow();
  });

  it("tells the generation about each column it must fill, and the ids to cover", async () => {
    const dir = copyFixture();
    await run(dir, "traces.save", { label: "Figure", patterns: [String.raw`\bFigure \d+`], field: "Figure" });
    const lines = traceGuidance(dir, [{ trace: "figure", ids: ["Figure 40"] }]).join("\n");
    expect(lines).toContain("### Figure: the Figure ids the step actually verifies");
    expect(lines).toContain("e.g. Figure 40");
    expect(lines).toContain("Figure ids to cover, each by at least one step: Figure 40");
    expect(lines).not.toContain("### Exigence");
  });

  it("asks Claude read-only for a proposal and previews what its patterns find", async () => {
    const dir = plainProject();
    env.spawnClaude = async (s) => {
      calls.push(s);
      return await mockSpawnClaude({ ...s, signal: undefined });
    };
    const r = (await run(dir, "traces.propose", { ask: "les numéros de figure" })) as {
      ok: boolean;
      proposal: { label: string; field: string };
      preview: { distinct: number };
      column: string;
    };
    expect(r).toMatchObject({ ok: true, proposal: { label: "Figure", field: "Figure" }, column: "local" });
    expect(r.preview.distinct).toBe(1);
    expect(calls[0].stdin).toContain("« les numéros de figure »");
    const tools = calls[0].args[calls[0].args.indexOf("--allowedTools") + 1] ?? calls[0].args.join(" ");
    expect(tools).not.toMatch(/\bEdit\b|\bWrite\b/);
    expect(readProject(dir).traces).toBeUndefined();
  });

  it("tells which ids the tests cover, by step, and which values no document writes", async () => {
    const dir = copyFixture();
    const [req] = (await run(dir, "traces.coverage")) as TraceCoverage[];
    expect(req).toMatchObject({ trace: "requirement", field: "Exigence", total: 5, covered: 5, tests: 2, unknown: [] });
    expect(req.items.find((i) => i.id === "EXI_MOP_SPF_511_A_1650")?.uses).toEqual([
      expect.objectContaining({ test: "LFRPS12-1420", key: "LFRPS12-1420", steps: [1] }),
      expect.objectContaining({ test: "local-3f9a12c0", steps: [1] }),
    ]);

    await run(dir, "traces.save", { label: "Figure", patterns: [String.raw`\bFigure \d+`], field: "Figure" });
    expect((await run(dir, "traces.coverage", { trace: "figure" })) as TraceCoverage[]).toEqual([
      expect.objectContaining({ total: 1, covered: 0, tests: 0, unknown: [] }),
    ]);
    const md = join(dir, "tests", "local-3f9a12c0", "test.md");
    writeFileSync(
      md,
      readFileSync(md, "utf8").replace(
        "### Exigence\n\nEXI_MOP_SPF_511_A_1650\n",
        "### Exigence\n\nEXI_MOP_SPF_511_A_1650\n\n### Figure\n\nFigure 40, Figure 99; schéma général\n",
      ),
      "utf8",
    );
    const [fig] = (await run(dir, "traces.coverage", { trace: "figure" })) as TraceCoverage[];
    expect(fig).toMatchObject({ total: 1, covered: 1, tests: 1 });
    expect(fig.items[0]).toMatchObject({ id: "Figure 40", uses: [{ test: "local-3f9a12c0", steps: [1] }] });
    expect(fig.unknown.map((u) => u.id)).toEqual(["Figure 99", "schéma général"]);
    await expect(run(dir, "traces.coverage", { trace: "nope" })).rejects.toThrow(/No tracked ids/);
  });

  it("checks each tracked column against the documents, and forgets the requirement field once it is not tracked", async () => {
    const dir = copyFixture();
    await run(dir, "traces.save", { label: "Figure", patterns: [String.raw`\bFigure \d+`], field: "Figure" });
    const md = join(dir, "tests", "local-3f9a12c0", "test.md");
    writeFileSync(
      md,
      readFileSync(md, "utf8").replace(
        "### Exigence\n\nEXI_MOP_SPF_511_A_1650\n",
        "### Exigence\n\nEXI_MOP_SPF_511_A_1650, EXI_NOPE_1\n\n### Figure\n\nFigure 40, Figure 99\n",
      ),
      "utf8",
    );
    const found = mechanicalCheck(dir, "local-3f9a12c0");
    expect(found.filter((f) => f.kind === "id-unknown")).toEqual([
      expect.objectContaining({ step: 1, severity: "error", message: expect.stringContaining("Figure 99") }),
    ]);
    expect(found.some((f) => f.kind === "requirement-unknown" && f.message.includes("EXI_NOPE_1"))).toBe(true);

    expect(requirementFieldOf(dir)).toBe("Exigence");
    await run(dir, "traces.remove", { id: "requirement" });
    expect(requirementFieldOf(dir)).toBeNull();
    expect(mechanicalCheck(dir, "local-3f9a12c0").some((f) => f.kind === "requirement-unknown")).toBe(false);
  });

  it("reads the proposal block, and nothing from a reply without one", () => {
    expect(
      parseProposal('```trace\n{"label":"Alarme","patterns":["\\\\bALM-\\\\d+"],"field":"Alarme","why":"…"}\n```'),
    ).toEqual({
      label: "Alarme",
      patterns: [String.raw`\bALM-\d+`],
      field: "Alarme",
      why: "…",
    });
    expect(parseProposal("Je n'ai rien trouvé.")).toBeNull();
  });
});
