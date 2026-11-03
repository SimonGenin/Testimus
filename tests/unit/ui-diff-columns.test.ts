import { describe, expect, it } from "vitest";
import type { Step, Test, XrayJson } from "../../src/core/types.ts";
import { columnsOf, modeOf, openByDefault, projectModes, splitTracks } from "../../src/ui/lib/columns.ts";
import { differs, diffLocal, lossOf, restoreStep } from "../../src/ui/lib/diff.ts";

const s = (id: string | undefined, action: string): Step => ({
  ...(id ? { id } : {}),
  fields: { Action: action },
  sources: [],
  images: [],
});
const t = (steps: Step[]): Test => ({
  project: "P",
  summary: "S",
  folder: "/",
  labels: [],
  description: "",
  covers: [],
  preconditions: [],
  review: "draft",
  steps,
  extra: {},
});

describe("diffLocal", () => {
  it("matches by step id: modified, new, and a deleted step placed after its predecessor", () => {
    const base = [s("1", "a"), s("2", "b"), s("3", "c")];
    const local = [s("3", "c"), s("1", "a2"), s(undefined, "n")];
    const d = diffLocal(local, base);
    expect(d.marks).toEqual(["same", "modified", "new"]);
    expect(d.gone).toEqual([{ at: 1, step: base[1] }]);
  });

  it("puts a deleted first step at the top", () => {
    expect(diffLocal([s("2", "b")], [s("1", "a"), s("2", "b")]).gone[0].at).toBe(-1);
  });

  it("restores a modified step in place and a deleted one where it was", () => {
    const base = [s("1", "a"), s("2", "b")];
    const local = t([s("1", "a2")]);
    const d = diffLocal(local.steps, base);
    const back = restoreStep(restoreStep(local, base[0], null), d.gone[0].step, d.gone[0]);
    expect(back.steps.map((x) => x.fields.Action)).toEqual(["a", "b"]);
    expect(lossOf(t([s("1", "a2"), s(undefined, "x")]), t(base))).toEqual({ modified: 1, added: 1, deleted: 1 });
  });

  it("differs sees header and step changes, ignores moved list order of covers", () => {
    const a = t([s("1", "a")]);
    expect(differs(a, { ...a, covers: [] })).toBe(false);
    expect(differs({ ...a, covers: ["B", "A"] }, { ...a, covers: ["A", "B"] })).toBe(false);
    expect(differs({ ...a, summary: "x" }, a)).toBe(true);
    expect(differs(t([s("1", "b")]), a)).toBe(true);
  });
});

const xray: XrayJson = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "data", name: "Data", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
    { id: "cf1", name: "Exigence", type: "text-single", builtin: false },
    { id: "cf2", name: "Note", type: "text", builtin: false },
    { id: "cf3", name: "Flag", type: "toggle", builtin: false },
  ],
  prefs: { order: [], collapsed: ["Note"], hidden: [], filled: ["Data"] },
};

describe("columns", () => {
  it("kinds: blocks for the built-ins, line, text, read-only; unknown names marked", () => {
    const cols = columnsOf(xray, { fields: { Autre: "x" }, sources: [], images: [] });
    expect(cols.map((c) => [c.name, c.kind, c.known])).toEqual([
      ["Action", "blocks", true],
      ["Data", "blocks", true],
      ["Expected Result", "blocks", true],
      ["Exigence", "line", true],
      ["Note", "text", true],
      ["Flag", "readonly", true],
      ["Autre", "text", false],
    ]);
  });

  it("modes: test over project over open; Action and Expected never fold", () => {
    const p = projectModes(xray);
    expect(p).toEqual({ Data: "filled", Note: "collapsed" });
    expect(modeOf({ name: "Data" }, p, null)).toBe("filled");
    expect(modeOf({ name: "Data" }, p, { Data: "collapsed" })).toBe("collapsed");
    expect(modeOf({ name: "Action" }, p, { Action: "collapsed" })).toBe("open");
    expect(openByDefault("filled", "")).toBe(false);
    expect(openByDefault("filled", "x")).toBe(true);
    expect(openByDefault("collapsed", "x")).toBe(false);
  });

  it("a column switched off in Xray is marked, folds unless filled, and can be set open for the project", () => {
    const x: XrayJson = {
      ...xray,
      fields: [...xray.fields, { id: "cf4", name: "Retired", type: "text", builtin: false, disabled: true }],
    };
    const col = columnsOf(x).find((c) => c.name === "Retired");
    expect(col).toMatchObject({ known: true, off: true, kind: "text" });
    expect(columnsOf(x).find((c) => c.name === "Note")?.off).toBeUndefined();
    if (!col) return;
    expect(modeOf(col, projectModes(x), null)).toBe("filled");
    expect(openByDefault(modeOf(col, projectModes(x), null), "")).toBe(false);
    expect(openByDefault(modeOf(col, projectModes(x), null), "kept")).toBe(true);
    const opened = { ...x, prefs: { ...x.prefs, open: ["Retired"] } };
    expect(modeOf(col, projectModes(opened), null)).toBe("open");
    expect(modeOf(col, projectModes(opened), { Retired: "collapsed" })).toBe("collapsed");
  });

  it("split tracks: Expected wider while Action is the only other field, project columns beside them narrower", () => {
    const cols = columnsOf(xray);
    const by = (n: string[]) => cols.filter((c) => n.includes(c.name));
    expect(splitTracks(by(["Action", "Expected Result"]))).toBe("minmax(0, 1fr) minmax(0, 1.25fr)");
    expect(splitTracks(by(["Action", "Data", "Expected Result", "Note"]))).toBe(
      "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.8fr)",
    );
    const withColumn = splitTracks(by(["Action", "Exigence", "Expected Result"]));
    expect(withColumn.match(/minmax/g)).toHaveLength(3);
    expect(withColumn).toContain("minmax(0, 1.25fr)");
  });
});
