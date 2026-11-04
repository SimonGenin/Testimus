// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Step, Test } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import {
  collapsible,
  columnsOf,
  MODES,
  modeOf,
  openByDefault,
  projectModes,
  splitTracks,
} from "../../../../src/ui/lib/columns.ts";
import { differs, diffLocal, lossOf, restoreStep, sameStep } from "../../../../src/ui/lib/diff.ts";
import { closeToast } from "../../../../src/ui/lib/toast.ts";
import { layoutOf } from "../../helpers/layout.ts";
import { fakeNet } from "../../helpers/ui-data.tsx";
import { noDesktop } from "../../helpers/ui-desktop.tsx";

const ids: number[] = [];

beforeEach(() => fakeNet());

afterEach(() => {
  act(() => {
    for (const id of ids) closeToast(id, true);
  });
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  noDesktop();
  setProject(null);
  localStorage.clear();
});

const step = (fields: Record<string, string>, id?: string, o: Partial<Step> = {}): Step => ({
  ...(id ? { id } : {}),
  fields,
  sources: [],
  images: [],
  ...o,
});

const test = (steps: Step[], o: Partial<Test> = {}): Test =>
  ({
    project: "P",
    summary: "S",
    folder: "/",
    labels: [],
    description: "",
    covers: [],
    preconditions: [],
    review: "draft",
    steps,
    ...o,
  }) as Test;

describe("columns", () => {
  const x = layoutOf(
    [
      { id: "a", name: "Action", type: "text", builtin: true },
      { id: "r", name: "Expected Result", type: "text", builtin: true },
      { id: "e", name: "Exigence", type: "text-single", builtin: false },
      { id: "n", name: "Note", type: "", builtin: false },
      { id: "s", name: "Select", type: "option", builtin: false },
      { id: "l", name: "Ref", type: "text-single", builtin: false },
    ],
    { order: [], collapsed: ["Note"], hidden: [], filled: ["Select"] },
  );

  it("gives each column its kind, unknown step-only names being text", () => {
    expect(columnsOf(x, step({ Extra: "x" }))).toEqual([
      { name: "Action", kind: "blocks", known: true },
      { name: "Expected Result", kind: "blocks", known: true },
      { name: "Exigence", kind: "line", known: true },
      { name: "Note", kind: "text", known: true },
      { name: "Select", kind: "readonly", known: true },
      { name: "Ref", kind: "line", known: true },
      { name: "Extra", kind: "text", known: false },
    ]);
  });

  it("layers the folding modes and opens a filled column only when it holds something", () => {
    expect(projectModes(x)).toEqual({
      Action: "open",
      "Expected Result": "open",
      Exigence: "open",
      Select: "filled",
      Note: "collapsed",
      Ref: "open",
    });
    expect(projectModes(layoutOf(x.fields, { hidden: ["Note"] }))).not.toHaveProperty("Note");
    expect(collapsible({ name: "Action" })).toBe(false);
    expect(modeOf({ name: "Action" }, { Action: "collapsed" }, null)).toBe("open");
    expect(modeOf({ name: "Note" }, { Note: "collapsed" }, { Note: "filled" })).toBe("filled");
    expect(modeOf({ name: "Note" }, { Note: "collapsed" }, null)).toBe("collapsed");
    expect(modeOf({ name: "Other" }, {}, {})).toBe("open");
    expect(openByDefault("open", "")).toBe(true);
    expect(openByDefault("filled", "  ")).toBe(false);
    expect(openByDefault("filled", "x")).toBe(true);
    expect(openByDefault("collapsed", "x")).toBe(false);
    expect(MODES.map((m) => m.value)).toEqual(["open", "filled", "collapsed"]);
  });

  it("sizes the split tracks", () => {
    const c = columnsOf(x);
    expect(splitTracks(c.slice(0, 2))).toBe("minmax(0, 1fr) minmax(0, 1.25fr)");
    expect(splitTracks(c)).toBe(
      "minmax(0, 1fr) minmax(0, 1.25fr) minmax(0, 0.6fr) minmax(0, 0.8fr) minmax(0, 0.8fr) minmax(0, 0.6fr)",
    );
    expect(splitTracks([c[1], c[0]])).toBe("minmax(0, 1.25fr) minmax(0, 1fr)");
  });
});

describe("diff", () => {
  it("compares steps on their filled fields, images and sources", () => {
    expect(sameStep(step({ A: "x", B: " " }), step({ A: "x" }))).toBe(true);
    expect(sameStep(step({ A: "x" }), step({ A: "y" }))).toBe(false);
    expect(sameStep(step({ B: "2", A: "1", C: "3" }), step({ C: "3", A: "1", B: "2" }))).toBe(true);
    const img = (file: string) => ({ file }) as Step["images"][number];
    expect(
      sameStep(step({}, undefined, { images: [img("a.png")] }), step({}, undefined, { images: [img("a.png")] })),
    ).toBe(true);
    expect(
      sameStep(
        step({}, undefined, { images: [{ file: "a.png" } as Step["images"][number]] }),
        step({}, undefined, { images: [] }),
      ),
    ).toBe(false);
    expect(sameStep(step({}, undefined, { sources: [{ docId: "D", anchor: "§1", quote: "" }] }), step({}))).toBe(false);
  });

  it("marks steps without an id as new and keeps base steps without an id as gone", () => {
    const local = [step({ A: "1" }), step({ A: "2" }, "s2")];
    const base = [step({ A: "0" }), step({ A: "2" }, "s2"), step({ A: "3" }, "s3")];
    expect(diffLocal(local, base)).toEqual({
      marks: ["new", "same"],
      gone: [
        { at: -1, step: base[0] },
        { at: 1, step: base[2] },
      ],
    });
    expect(lossOf(test(local), test(base))).toEqual({ modified: 0, added: 1, deleted: 2 });
  });

  it("restores a step without an id at the end, or after where it was", () => {
    const local = test([step({ A: "1" }, "s1")]);
    const lone = step({ A: "z" });
    expect(restoreStep(local, lone, null).steps.map((s) => s.fields.A)).toEqual(["1", "z"]);
    expect(restoreStep(local, lone, { at: -1, step: lone }).steps.map((s) => s.fields.A)).toEqual(["z", "1"]);
    expect(restoreStep(local, step({ A: "x" }, "gone"), null).steps).toHaveLength(2);
  });

  it("sees a test differ by its header, its step count or a step's id", () => {
    const a = test([step({ A: "1" }, "s1")]);
    expect(differs(a, test([step({ A: "1" }, "s1")]))).toBe(false);
    expect(differs(a, test([step({ A: "1" }, "s1")], { clonedFrom: "X-1" }))).toBe(true);
    expect(differs(a, test([]))).toBe(true);
    expect(differs(a, test([step({ A: "1" }, "other")]))).toBe(true);
    expect(differs(a, test([step({ A: "1" }, "s1")], { description: " \n" }))).toBe(false);
  });
});
