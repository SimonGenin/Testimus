import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkGenInput, genPrompt } from "../../src/core/claude/generate.ts";
import { contextLines, readContexts } from "../../src/core/claude/prompt.ts";
import { invoke } from "../../src/core/commands/index.ts";
import {
  columnGuidance,
  DEFAULT_DESCRIPTIONS,
  followXray,
  removeColumn,
  saveColumn,
  stepColumns,
} from "../../src/core/lib/columns.ts";
import { fieldOrder, readProject, readXray, writeXray } from "../../src/core/lib/project.ts";
import { scopeIds } from "../../src/core/lib/traces.ts";
import type { XrayField } from "../../src/core/types.ts";

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
const xray = (custom: XrayField[] = [], more: Record<string, unknown> = {}) =>
  writeXray(dir, {
    fields: [...BUILTIN, ...custom],
    prefs: { order: [], collapsed: [], hidden: [] },
    ...more,
  });
const exigence: XrayField = { id: "cf1", name: "Exigence", type: "text", builtin: false };
const run = (name: string, input: unknown = {}) => invoke(name, input, { project: dir, wait: true });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-cov-columns-"));
  project();
  xray();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("step columns", () => {
  it("the built-ins carry a default description; a custom field never described is new", () => {
    xray([exigence, { id: "cf2", name: "Version", type: "text", builtin: false }]);
    const cols = stepColumns(dir);
    expect(cols.map((c) => [c.name, c.origin, c.status])).toEqual([
      ["Action", "xray", "ok"],
      ["Data", "xray", "ok"],
      ["Expected Result", "xray", "ok"],
      ["Exigence", "xray", "ok"],
      ["Version", "xray", "new"],
    ]);
    expect(cols[0].description).toBe(DEFAULT_DESCRIPTIONS.Action);
    expect(cols[3].description).toBe("The Requirement ids this step actually verifies, comma-separated.");
    expect(cols[4].description).toBe("");
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
    expect(readXray(dir).columns?.filter((c) => c.name === "Remarque")).toHaveLength(1);
    expect(fieldOrder(readXray(dir))).toContain("Remarque");
    expect(await run("columns.list")).toHaveLength(5);
  });

  it("refuses an empty, multi-line, reserved or taken name", () => {
    expect(() => saveColumn(dir, { name: " " })).toThrow(/needs a name/);
    expect(() => saveColumn(dir, { name: "A\nB" })).toThrow(/cannot be a column name/);
    expect(() => saveColumn(dir, { name: "#x" })).toThrow(/cannot be a column name/);
    expect(() => saveColumn(dir, { name: "Sources" })).toThrow(/section of test.md/);
    saveColumn(dir, { name: "Note" });
    xray([], { columns: [{ name: "Note" }, { name: "Note2" }] });
    expect(() => saveColumn(dir, { name: "Autre", description: "" })).not.toThrow();
  });

  it("removes a local column with its folding and tracked ids, never an Xray field", async () => {
    project({ traces: [{ id: "note", label: "Note", patterns: ["N-\\d+"], field: "Note" }] });
    xray([exigence], {
      columns: [{ name: "Note", description: "x" }],
      prefs: { order: ["Note"], collapsed: ["Note"], hidden: ["Note"], filled: ["Note"], open: ["Note"] },
    });
    expect(() => removeColumn(dir, "Exigence")).toThrow(/can be hidden, not removed/);
    expect(() => removeColumn(dir, "Nope")).toThrow(/No column called/);
    await run("columns.remove", { name: "note" });
    const x = readXray(dir);
    expect(x.columns).toBeUndefined();
    expect(x.prefs).toMatchObject({ order: [], collapsed: [], hidden: [], filled: [], open: [] });
    expect(readProject(dir).traces).toEqual([]);
  });

  it("an id column tracked before its Xray field exists is a local column, removable", () => {
    project({ traces: [{ id: "uc", label: "Use case", patterns: ["UC-\\d+"], field: "Cas" }] });
    const cas = stepColumns(dir).find((c) => c.name === "Cas");
    expect(cas).toMatchObject({ origin: "local", status: "ok", description: expect.stringContaining("Use case ids") });
    removeColumn(dir, "Cas");
    expect(readProject(dir).traces).toEqual([]);
  });

  it("follows Xray: a rename keeps the description, folding and tracked ids; a dropped field stays local", () => {
    project({ traces: [{ id: "requirement", label: "Requirement", patterns: ["EXI_\\d+"], field: "Exigence" }] });
    const gone: XrayField = { id: "cf3", name: "Ancien", type: "text", builtin: false };
    xray([exigence, gone], {
      columns: [
        { name: "Exigence", id: "cf1", description: "Les exigences" },
        { name: "Version", description: "La version" },
      ],
      prefs: { order: ["Exigence"], collapsed: ["Exigence"], hidden: [], filled: ["Exigence"], open: ["Exigence"] },
    });
    const now: XrayField[] = [
      ...BUILTIN,
      { ...exigence, name: "Exigences" },
      { id: "cf9", name: "version", type: "text", builtin: false },
    ];
    const next = followXray(dir, readXray(dir), now);
    writeXray(dir, next);
    expect(next.prefs).toMatchObject({ order: ["Exigences"], collapsed: ["Exigences"], open: ["Exigences"] });
    expect(next.columns).toEqual([
      { name: "Exigences", id: "cf1", description: "Les exigences" },
      { name: "version", id: "cf9", description: "La version" },
      { name: "Ancien", id: "cf3" },
    ]);
    expect(readProject(dir).traces?.[0].field).toBe("Exigences");
    const cols = stepColumns(dir);
    expect(cols.find((c) => c.name === "Ancien")).toMatchObject({ origin: "local", status: "gone" });
    expect(cols.find((c) => c.name === "version")).toMatchObject({ origin: "xray", description: "La version" });
    const plain = followXray(dir, { ...readXray(dir), columns: undefined }, now);
    expect(plain.columns).toBeUndefined();
  });

  it("guides the generation: described columns, empty ones left out, ids of the scope", () => {
    project({ traces: [{ id: "requirement", label: "Requirement", patterns: ["EXI_\\d+"], field: "Exigence" }] });
    xray([exigence], { columns: [{ name: "Data", id: "data", description: "" }] });
    write(
      "docs/D/doc.md",
      "# D\n\n## 1 A <!-- § 1 -->\n\nEXI_1 <!-- req EXI_9 -->\n\n### 1.1 B <!-- § 1.1 -->\n\nEXI_2\n\n## 2 C <!-- § 2 -->\n\nEXI_3\n",
    );
    write("docs/E/doc.md", "# E\n\nEXI_4\n");
    const lines = columnGuidance(dir, { docs: ["E"], sections: ["D#§1"] }).join("\n");
    expect(lines).toContain("- ### Action: ");
    expect(lines).toContain("Leave these columns empty — never write them: Data.");
    expect(lines).toMatch(/cannot cover\): EXI_1, EXI_2, EXI_4$/m);
    expect(scopeIds(dir, ["EXI_\\d+"], { docs: [], sections: [] })).toEqual([]);
    expect(columnGuidance(dir).join("\n")).not.toContain("written in the scope");
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
    expect(p).toContain("Step columns — write each as ### <column>");
    expect(p).toContain("Additional context from the user for this run:\nPoste PCC");
    expect(genPrompt(dir, { request: "", docs: ["D"] })).toContain("(cover the behaviors they specify)");
  });

  it("context lines: saved contexts pointed at, the note said in full, nothing when both are empty", () => {
    write("contexts/c1/context.json", JSON.stringify({ name: "Glossaire", paths: [] }));
    write("contexts/c1/notes.md", "TK");
    const lines = contextLines(dir, readContexts(dir, ["c1"]), "Note");
    expect(lines[1]).toMatch(/Context to read before you start/);
    expect(lines[2]).toMatch(/^- Glossaire — notes: .*contexts\/c1\/notes\.md$/);
    expect(lines.slice(-2)).toEqual(["Additional context from the user for this run:", "Note"]);
    expect(contextLines(dir, [], " ")).toEqual([]);
  });
});
