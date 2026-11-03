import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkGenInput, genPrompt } from "../../src/core/claude/gen-prompt.ts";
import { contextLines, readContexts } from "../../src/core/claude/prompt.ts";
import { invoke } from "../../src/core/commands/index.ts";
import {
  columnGuidance,
  DEFAULT_DESCRIPTIONS,
  fieldOrder,
  followXray,
  readColumns,
  removeColumn,
  saveColumn,
  setModes,
  setOrder,
  stepColumns,
  writeColumns,
} from "../../src/core/lib/columns.ts";
import { readXray, writeXray } from "../../src/core/lib/project.ts";
import type { ColumnEntry, XrayField } from "../../src/core/types.ts";

let dir = "";
const write = (rel: string, text: string) => {
  const file = join(dir, rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
};
const project = (json: Record<string, unknown> = {}) =>
  write("project.json", JSON.stringify({ name: "t", jiraProject: "T", ...json }));
const BUILTIN: XrayField[] = [
  { id: "action", name: "Action", type: "text", builtin: true },
  { id: "data", name: "Data", type: "text", builtin: true },
  { id: "result", name: "Expected Result", type: "text", builtin: true },
];
type Entry = Omit<ColumnEntry, "mode"> & { mode?: ColumnEntry["mode"] };
const xray = (custom: XrayField[] = [], columns: Entry[] = []) => {
  writeXray(dir, { fields: [...BUILTIN, ...custom] });
  writeColumns(
    dir,
    columns.map((c) => ({ ...c, mode: c.mode ?? "open" })),
  );
};
const exigence: XrayField = { id: "cf1", name: "Exigence", type: "text", builtin: false };
const run = (name: string, input: unknown = {}) => invoke(name, input, { project: dir, wait: true });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-cov-columns-"));
  project();
  xray();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("smart columns", () => {
  it("the built-ins carry a default description; a custom field never described is new", () => {
    xray(
      [exigence, { id: "cf2", name: "Version", type: "text", builtin: false }],
      [
        { name: "Action", id: "action" },
        { name: "Data", id: "data", mode: "filled" },
        { name: "Expected Result", id: "result" },
        { name: "Exigence", id: "cf1", description: "Le numéro du paragraphe" },
      ],
    );
    const cols = stepColumns(dir);
    expect(cols.map((c) => [c.name, c.origin, c.status])).toEqual([
      ["Action", "xray", "ok"],
      ["Data", "xray", "ok"],
      ["Expected Result", "xray", "ok"],
      ["Exigence", "xray", "ok"],
      ["Version", "xray", "new"],
    ]);
    expect(cols[0].description).toBe(DEFAULT_DESCRIPTIONS.Action);
    expect(cols[3].description).toBe("Le numéro du paragraphe");
    expect(cols[4].description).toBe("");
    expect(cols.map((c) => c.mode)).toEqual(["open", "filled", "open", "open", "open"]);
  });

  it("saves a description, keeps an empty one empty, and adds a local column after the fields", async () => {
    xray([exigence]);
    saveColumn(dir, { name: "action", description: "  Un geste " });
    saveColumn(dir, { name: "Data", description: "" });
    saveColumn(dir, { name: "Action", description: "Deux gestes" });
    const cols = (await run("columns.save", { name: "Remarque", description: "Libre" })) as { name: string }[];
    expect(cols.map((c) => c.name)).toEqual(["Action", "Data", "Expected Result", "Exigence", "Remarque"]);
    const all = stepColumns(dir);
    expect(all.find((c) => c.name === "Action")?.description).toBe("Deux gestes");
    expect(all.find((c) => c.name === "Data")?.description).toBe("");
    expect(all.find((c) => c.name === "Remarque")).toMatchObject({
      origin: "local",
      status: "ok",
      description: "Libre",
    });
    saveColumn(dir, { name: "remarque", description: "Autre" });
    expect(readColumns(dir).filter((c) => c.name === "Remarque")).toHaveLength(1);
    expect(fieldOrder(dir)).toContain("Remarque");
    expect(await run("columns.list")).toHaveLength(5);
  });

  it("refuses an empty, multi-line, reserved or taken name", () => {
    expect(() => saveColumn(dir, { name: " " })).toThrow(/needs a name/);
    expect(() => saveColumn(dir, { name: "A\nB" })).toThrow(/cannot be a column name/);
    expect(() => saveColumn(dir, { name: "#x" })).toThrow(/cannot be a column name/);
    expect(() => saveColumn(dir, { name: "Sources" })).toThrow(/section of test.md/);
    saveColumn(dir, { name: "Note" });
    expect(() => saveColumn(dir, { name: "note", description: "x" })).not.toThrow();
    xray([], [{ name: "Note" }, { name: "Note2" }]);
    expect(() => saveColumn(dir, { name: "Autre", description: "" })).not.toThrow();
  });

  it("removes a local column with its folding, never an Xray field", async () => {
    xray([exigence], [{ name: "Note", description: "x", mode: "collapsed" }]);
    expect(() => removeColumn(dir, "Exigence")).toThrow(/can be hidden, not removed/);
    expect(() => removeColumn(dir, "Nope")).toThrow(/No column called/);
    await run("columns.remove", { name: "note" });
    expect(readColumns(dir).map((c) => c.name)).toEqual(["Action", "Data", "Expected Result", "Exigence"]);
    expect(stepColumns(dir).some((c) => c.name === "Note")).toBe(false);
  });

  it("sets modes and the order in columns.json, refusing a name no column has", async () => {
    xray([exigence]);
    setModes(dir, { Exigence: "collapsed", Data: "hidden" });
    expect(stepColumns(dir).map((c) => [c.name, c.mode])).toEqual([
      ["Action", "open"],
      ["Data", "hidden"],
      ["Expected Result", "open"],
      ["Exigence", "collapsed"],
    ]);
    setOrder(dir, ["Exigence", "Action"]);
    expect(fieldOrder(dir)).toEqual(["Exigence", "Action", "Data", "Expected Result"]);
    expect(readColumns(dir).map((c) => c.name)).toEqual(["Exigence", "Action", "Data", "Expected Result"]);
    expect(() => setModes(dir, { Nope: "open" })).toThrow(/Not a step column of this project: Nope/);
    await expect(run("columns.order", { names: ["Nope"] })).rejects.toThrow(/Not a step column/);
    const cols = (await run("columns.setModes", { modes: { Exigence: "filled" } })) as { name: string; mode: string }[];
    expect(cols.find((c) => c.name === "Exigence")?.mode).toBe("filled");
  });

  it("follows Xray: a rename keeps the description and folding; a dropped field stays local", () => {
    const gone: XrayField = { id: "cf3", name: "Ancien", type: "text", builtin: false };
    xray(
      [exigence, gone],
      [
        { name: "Exigence", id: "cf1", description: "Les exigences", mode: "collapsed" },
        { name: "Version", description: "La version" },
      ],
    );
    const now: XrayField[] = [
      ...BUILTIN,
      { ...exigence, name: "Exigences" },
      { id: "cf9", name: "version", type: "text", builtin: false },
    ];
    const next = followXray(readXray(dir), readColumns(dir), now);
    writeXray(dir, { fields: now });
    writeColumns(dir, next);
    expect(next).toEqual([
      { name: "Exigences", id: "cf1", description: "Les exigences", mode: "collapsed" },
      { name: "version", id: "cf9", description: "La version", mode: "open" },
      { name: "Ancien", id: "cf3", mode: "open" },
    ]);
    const cols = stepColumns(dir);
    expect(fieldOrder(dir)[0]).toBe("Exigences");
    expect(cols.find((c) => c.name === "Ancien")).toMatchObject({ origin: "local", status: "gone" });
    expect(cols.find((c) => c.name === "version")).toMatchObject({ origin: "xray", description: "La version" });
    expect(followXray(readXray(dir), [], now)).toEqual([]);
  });

  it("guides the generation: each described smart column with its description, empty ones left out", () => {
    xray(
      [exigence],
      [
        { name: "Data", id: "data", description: "" },
        { name: "Exigence", id: "cf1", description: "Le paragraphe vérifié" },
      ],
    );
    const lines = columnGuidance(dir);
    expect(lines[1]).toBe("Smart columns — write each as ### <column> in every step, following its description:");
    expect(lines).toContain(`- ### Action: ${DEFAULT_DESCRIPTIONS.Action}`);
    expect(lines).toContain("- ### Exigence: Le paragraphe vérifié");
    expect(lines.at(-1)).toBe("Leave these columns empty — never write them: Data.");
    xray();
    expect(columnGuidance(dir).some((l) => l.startsWith("Leave"))).toBe(false);
  });
});

describe("generation input", () => {
  it("a whole document is enough; an unknown one is refused", () => {
    write("docs/D/doc.md", "# D\n");
    expect(() => checkGenInput({ request: "", docs: ["D"] }, dir)).not.toThrow();
    expect(() => checkGenInput({ request: "", docs: ["Z"] }, dir)).toThrow(/No document Z/);
    expect(() => checkGenInput({ request: "" })).toThrow(/Nothing to generate/);
  });

  it("the prompt names the documents, the columns and the note", () => {
    write("docs/D/doc.md", "# D\n");
    const p = genPrompt(dir, { request: "Menus", docs: ["D"], note: " Poste PCC " });
    expect(p).toContain("Documents in scope, each in full (find in them what the request is about): D");
    expect(p).toContain("Smart columns — write each as ### <column>");
    expect(p).toContain("Additional context from the user for this run:\nPoste PCC");
    expect(genPrompt(dir, { request: "", docs: ["D"] })).toContain("(test the behaviors they specify)");
  });

  it("context lines: saved contexts pointed at, the note said in full, nothing when both are empty", () => {
    write("contexts/c1/context.md", "---\nname: Glossaire\npaths:\n---\nTK");
    const lines = contextLines(dir, readContexts(dir, ["c1"]), "Note");
    expect(lines[1]).toMatch(/Context to read before you start/);
    expect(lines[2]).toMatch(/^- Glossaire — notes: .*contexts\/c1\/context\.md$/);
    expect(lines.slice(-2)).toEqual(["Additional context from the user for this run:", "Note"]);
    expect(contextLines(dir, [], " ")).toEqual([]);
  });

  it("context lines: the uncleared conversation of the panel comes last, as background", () => {
    const lines = contextLines(dir, [], "Note", " User: Raccourcis\n\nClaude: Fait ");
    expect(lines.slice(-2)).toEqual([
      "Earlier in this conversation (background: what was asked and answered before; the request below is what to do now):",
      "User: Raccourcis\n\nClaude: Fait",
    ]);
    expect(contextLines(dir, [], "", " ")).toEqual([]);
  });
});
