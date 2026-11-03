import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { columnsPrompt, columnUse, parseColumns, toProposals } from "../../src/core/claude/columns.ts";
import { invoke } from "../../src/core/commands/index.ts";
import { type ClaudeSpawn, env } from "../../src/core/env.ts";
import { stepColumns } from "../../src/core/lib/columns.ts";
import {
  DEFAULT_SETTINGS,
  readProject,
  readXray,
  writeProject,
  writeSettings,
  writeXray,
} from "../../src/core/lib/project.ts";
import { mockSpawnClaude } from "../../src/core/mock/claude.ts";
import "../../src/core/mock/claude-columns.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/project/", import.meta.url));
const real = env.spawnClaude;
let calls: ClaudeSpawn[] = [];

function copyFixture(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "testimus-colsuggest-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

const run = (dir: string, name: string, input: unknown = {}) => invoke(name, input, { project: dir, wait: true });

beforeEach(() => {
  calls = [];
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  env.spawnClaude = async (s) => {
    calls.push(s);
    return await mockSpawnClaude({ ...s, signal: undefined });
  };
});
afterEach(() => {
  env.spawnClaude = real;
});

describe("columns.suggest", () => {
  it("tells Claude the columns, Xray's fields, the defaults, how the tests fill them, the documents and the contexts", () => {
    const dir = copyFixture();
    writeProject(dir, { ...readProject(dir), glossary: { TCO: "Tableau de contrôle optique" } });
    const prompt = columnsPrompt(dir, "  le poste de chaque step  ", [], "Les tests de la ligne 12");
    expect(prompt.startsWith("Testimus smart columns: use the define-columns skill")).toBe(true);
    expect(prompt).toContain("The user asks: « le poste de chaque step »");
    expect(prompt).toContain("- Action (Xray standard)");
    expect(prompt).toContain(
      "- Exigence (Xray custom field, new in Xray, never described)\n  description: (empty — Claude never fills it)",
    );
    expect(prompt).toMatch(/- Data \(Xray standard\)\n {2}description: The values entered/);
    expect(prompt).toMatch(
      /- Action \(Xray standard\)\n {2}description: [^\n]*\n {2}in the tests: filled in \d+ of \d+ steps, in \d+ tests\n {4}e\.g\. LFRPS12-/,
    );
    expect(prompt).toContain("Testimus' defaults for Xray's standard columns");
    expect(prompt).toContain("SOSIE_211_D401-1_3 «");
    expect(prompt).toContain("- TCO: Tableau de contrôle optique");
    expect(prompt).toContain("Additional context from the user for this run:\nLes tests de la ligne 12");
    expect(prompt).toContain("```columns");
    expect(columnsPrompt(dir, "", [])).toContain("No request: review every column");
  });

  it("says what each Xray field is, and when Xray was never read", () => {
    const dir = copyFixture();
    const x = readXray(dir);
    const prompt = columnsPrompt(dir, "", []);
    expect(prompt).toContain("were read on 2026-10-30");
    x.fields.push({ id: "cf-r", name: "Résultat obtenu", type: "text", builtin: false });
    x.prefs.order = ["Action", "Data", "Expected Result", "Exigence"];
    x.prefs.hidden = ["Résultat obtenu"];
    delete x.fetchedAt;
    writeXray(dir, x);
    const again = columnsPrompt(dir, "", []);
    expect(again).toContain("never read");
    expect(again).toMatch(/- Résultat obtenu \(Xray custom field, hidden in the editor/);
  });

  it("counts what the tests hold, pulled tests first", () => {
    const dir = copyFixture();
    const use = columnUse(dir, ["Action", "Nowhere"]);
    expect(use.get("Action")?.filled).toBeGreaterThan(0);
    expect(use.get("Action")?.examples[0]).toMatch(/^LFRPS12-/);
    expect(use.get("Nowhere")).toMatchObject({ filled: 0, tests: 0, examples: [] });
  });

  it("reads the columns block, a bare list, and nothing", () => {
    expect(
      parseColumns('x\n```columns\n{"columns":[{"name":" Data ","description":" d ","why":"w"},{"name":""},3]}\n```'),
    ).toEqual([{ name: "Data", description: "d", why: "w" }]);
    expect(parseColumns('```json\n[{"name":"A","description":""}]\n```')).toEqual([
      { name: "A", description: "", why: "" },
    ]);
    expect(parseColumns("```columns\nnot json\n```")).toBeNull();
    expect(parseColumns('```columns\n{"x":1}\n```')).toBeNull();
    expect(parseColumns("no block")).toBeNull();
  });

  it("matches a proposal to its column whatever the case, and drops one that changes nothing or repeats", () => {
    const dir = copyFixture();
    const cols = stepColumns(dir);
    const data = cols.find((c) => c.name === "Data")?.description ?? "";
    expect(
      toProposals(cols, [
        { name: "data", description: data, why: "" },
        { name: "expected result", description: "Ce qui s'affiche.", why: "w" },
        { name: "Expected Result", description: "twice", why: "" },
        { name: "Exigence", description: "", why: "nobody" },
        { name: "Exigence ", description: "La référence du passage.", why: "r" },
        { name: "Poste", description: "Le poste.", why: "p" },
      ]),
    ).toEqual([
      expect.objectContaining({
        name: "Expected Result",
        kind: "xray",
        builtin: true,
        description: "Ce qui s'affiche.",
      }),
      expect.objectContaining({
        name: "Exigence",
        kind: "xray",
        builtin: false,
        current: "",
        description: "La référence du passage.",
      }),
      { name: "Poste", kind: "new", builtin: false, current: null, description: "Le poste.", why: "p" },
    ]);
  });

  it("runs Claude read-only with the define-columns skill and saves nothing", async () => {
    const dir = copyFixture();
    const before = JSON.stringify(readXray(dir));
    const r = (await run(dir, "columns.suggest", { ask: "le poste opérateur" })) as {
      ok: boolean;
      proposals: { name: string; kind: string; current: string | null }[];
    };
    expect(r.ok).toBe(true);
    expect(r.proposals.map((p) => [p.name, p.kind])).toEqual([
      ["Expected Result", "xray"],
      ["Data", "xray"],
      ["Poste", "new"],
    ]);
    expect(r.proposals[2].current).toBeNull();
    expect(calls[0].stdin).toContain("« le poste opérateur »");
    const tools = calls[0].args[calls[0].args.indexOf("--tools") + 1];
    expect(tools).toBe("Read,Glob,Grep,Skill");
    const allowed = calls[0].args[calls[0].args.indexOf("--allowedTools") + 1];
    expect(allowed).not.toMatch(/columns_save|tests_save/);
    expect(JSON.stringify(readXray(dir))).toBe(before);
  });

  it("is not ok when Claude gives no block, and an empty list when it proposes nothing", async () => {
    const dir = copyFixture();
    const none = (await run(dir, "columns.suggest", { ask: "rien à changer" })) as { ok: boolean; proposals: [] };
    expect(none).toMatchObject({ ok: true, proposals: [] });
    env.spawnClaude = async (s) => await mockSpawnClaude({ ...s, stdin: "plain", signal: undefined });
    const bad = (await run(dir, "columns.suggest", {})) as { ok: boolean; summary: string };
    expect(bad).toMatchObject({ ok: false, summary: "ok" });
  });
});
