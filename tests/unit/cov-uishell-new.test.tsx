// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Step, Test, TraceView, XrayJson } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { ConnectClaude } from "../../src/ui/components/claude/ConnectClaude.tsx";
import { cap, ModelPicker } from "../../src/ui/components/claude/ModelPicker.tsx";
import { OnTopToggle } from "../../src/ui/components/claude/OnTopToggle.tsx";
import { TracesBar } from "../../src/ui/components/traces/TracesBar.tsx";
import { Confirm, Toasts } from "../../src/ui/components/ui/index.ts";
import type { AppState } from "../../src/ui/lib/app.ts";
import {
  collapsible,
  columnsOf,
  MODES,
  modeOf,
  openByDefault,
  projectModes,
  splitTracks,
} from "../../src/ui/lib/columns.ts";
import { readAlwaysOnTop, restoreAlwaysOnTop, setAlwaysOnTop } from "../../src/ui/lib/desktop.ts";
import { differs, diffLocal, lossOf, restoreStep, sameStep } from "../../src/ui/lib/diff.ts";
import { discardEditor, setDiscarder } from "../../src/ui/lib/editorBus.ts";
import { fieldViews, isRequirementField } from "../../src/ui/lib/fields.ts";
import { addRecent, forgetRecent, RECENT_DAYS, recentIds, renameRecent } from "../../src/ui/lib/recent.ts";
import { closeToast, useToasts } from "../../src/ui/lib/toast.ts";
import { exampleOf, REQUIREMENT, setTraces, traceOfField, tracesNow } from "../../src/ui/lib/traces.ts";
import { callsOf, fakeNet, net, withApp } from "./cov-uishell-helpers.tsx";
import { app, fakeDesktop, noDesktop } from "./ui-desktop-helpers.tsx";

let ids: number[] = [];
function Probe() {
  ids = useToasts().map((t) => t.id);
  return <Toasts />;
}

beforeEach(() => fakeNet());

afterEach(() => {
  act(() => {
    for (const id of ids) closeToast(id, true);
  });
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  noDesktop();
  setTraces(null);
  setProject(null);
  localStorage.clear();
});

const trace = (o: Partial<TraceView> = {}): TraceView => ({
  id: "req",
  label: "Exigence",
  patterns: ["\\bEXI_[A-Z]+_\\d+\\b"],
  field: "Exigence",
  origin: "declared",
  column: "in-xray",
  found: 1,
  docs: 1,
  ...o,
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

describe("traces store and the field helpers", () => {
  it("finds a trace by its column, whatever the case and spaces", () => {
    expect(tracesNow()).toBeNull();
    expect(traceOfField("Exigence")).toBeUndefined();
    setTraces([trace()]);
    expect(tracesNow()).toHaveLength(1);
    expect(traceOfField("  exigence ")?.id).toBe("req");
    expect(REQUIREMENT).toBe("requirement");
  });

  it("writes an example id out of the first pattern, or falls back to the label", () => {
    expect(exampleOf({ patterns: ["\\bEXI_[A-Z]+_\\d+\\b"], label: "Exigence" })).toBe("EXI__…");
    expect(exampleOf({ patterns: ["ALM-\\d{3}"], label: "Alarme" })).toBe("ALM-…");
    expect(exampleOf({ patterns: ["(?:UC|CU)\\.\\d+"], label: "Cas" })).toBe("UCCU.…");
    expect(exampleOf({ patterns: ["\\d+"], label: "Numéro" })).toBe("Numéro");
    expect(exampleOf({ patterns: [], label: "Vide" })).toBe("Vide");
  });

  it("uses the tracked columns once the project is read", () => {
    const x: XrayJson = {
      fields: [{ id: "a", name: "Action", type: "text", builtin: true }],
      prefs: { order: [], collapsed: [], hidden: [] },
    };
    expect(isRequirementField("Exigence")).toBe(true);
    setTraces([trace(), trace({ id: "alm", field: "Action" })]);
    expect(isRequirementField("Exigence")).toBe(true);
    expect(isRequirementField("Requirements")).toBe(false);
    const views = fieldViews(x);
    expect(views.map((v) => [v.name, v.requirements, v.trace?.id])).toEqual([
      ["Action", true, "alm"],
      ["Exigence", true, "req"],
    ]);
  });
});

describe("editor bus discard", () => {
  it("hands the test about to be deleted to the editor, when one is listening", () => {
    discardEditor("t0");
    const fn = vi.fn();
    setDiscarder(fn);
    discardEditor("t1");
    expect(fn).toHaveBeenCalledWith("t1");
    setDiscarder(null);
    discardEditor("t2");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("recent tests", () => {
  it("keeps the newest first per project, renames and forgets", () => {
    const seen = vi.fn();
    window.addEventListener("testimus:recent", seen);
    setProject("D:/a");
    addRecent("t1");
    addRecent("t2");
    addRecent("t1");
    expect(recentIds()).toEqual(["t1", "t2"]);
    setProject("D:/b");
    addRecent("x");
    expect(recentIds()).toEqual(["x"]);
    setProject("D:/a");
    renameRecent("t2", "LFRPS12-9");
    expect(recentIds()).toEqual(["t1", "LFRPS12-9"]);
    forgetRecent("t1");
    expect(recentIds()).toEqual(["LFRPS12-9"]);
    expect(seen).toHaveBeenCalledTimes(6);
    window.removeEventListener("testimus:recent", seen);
    setProject(null);
    addRecent("none");
    expect(recentIds()).toEqual(["none"]);
    expect(RECENT_DAYS).toBe(7);
  });

  it("caps the list at twenty and survives bad or unreadable storage", () => {
    for (let i = 0; i < 25; i++) addRecent(`t${i}`);
    expect(recentIds()).toHaveLength(20);
    expect(recentIds()[0]).toBe("t24");
    localStorage.setItem("testimus.recent", '{"not":"a list"}');
    expect(recentIds()).toEqual([]);
    localStorage.setItem("testimus.recent", '["|a", 3, null]');
    expect(recentIds()).toEqual(["a"]);
    localStorage.setItem("testimus.recent", "{broken");
    expect(recentIds()).toEqual([]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    addRecent("y");
    expect(recentIds()).toEqual([]);
  });
});

describe("columns", () => {
  const x: XrayJson = {
    fields: [
      { id: "a", name: "Action", type: "text", builtin: true },
      { id: "r", name: "Expected Result", type: "text", builtin: true },
      { id: "e", name: "Exigence", type: "text-single", builtin: false },
      { id: "n", name: "Note", type: "", builtin: false },
      { id: "s", name: "Select", type: "option", builtin: false },
      { id: "l", name: "Ref", type: "text-single", builtin: false },
    ],
    prefs: { order: [], collapsed: ["Note"], hidden: [], filled: ["Select"] },
  };

  it("gives each column its kind, unknown step-only names being text", () => {
    expect(columnsOf(x, step({ Extra: "x" }))).toEqual([
      { name: "Action", kind: "blocks", known: true },
      { name: "Expected Result", kind: "blocks", known: true },
      { name: "Exigence", kind: "requirements", known: true },
      { name: "Note", kind: "text", known: true },
      { name: "Select", kind: "readonly", known: true },
      { name: "Ref", kind: "line", known: true },
      { name: "Extra", kind: "text", known: false },
    ]);
  });

  it("layers the folding modes and opens a filled column only when it holds something", () => {
    expect(projectModes(x)).toEqual({ Select: "filled", Note: "collapsed" });
    expect(projectModes({ ...x, prefs: { order: [], collapsed: [], hidden: [] } })).toEqual({});
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

describe("Confirm", () => {
  it("asks before a dangerous action, saying what is lost", () => {
    const yes = vi.fn();
    const no = vi.fn();
    const { rerender } = render(
      <Confirm title="Delete the test" confirm="Delete" danger loss="3 steps" onConfirm={yes} onClose={no}>
        <p>LFRPS12-1</p>
      </Confirm>,
    );
    expect(screen.getByRole("dialog", { name: "Delete the test" })).toBeInTheDocument();
    expect(screen.getByText("3 steps")).toHaveClass("loss");
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("btn-danger");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(yes).toHaveBeenCalled();
    expect(no).toHaveBeenCalled();
    rerender(
      <Confirm title="Go" confirm="Go" busy onConfirm={yes} onClose={no}>
        <p>x</p>
      </Confirm>,
    );
    expect(screen.getByRole("button", { name: "Go" })).toHaveClass("btn-primary");
    expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
    expect(document.querySelector(".loss")).toBeNull();
  });
});

describe("always on top", () => {
  it("remembers the choice, and tells the window only in the desktop shell", async () => {
    const seen = vi.fn();
    window.addEventListener("testimus:on-top", (e) => seen((e as CustomEvent).detail));
    expect(readAlwaysOnTop()).toBe(false);
    expect(await setAlwaysOnTop(true)).toBe(false);
    expect(readAlwaysOnTop()).toBe(true);
    expect(seen).toHaveBeenLastCalledWith(true);
    fakeDesktop();
    expect(await setAlwaysOnTop(false)).toBe(false);
    fakeDesktop();
    const set = vi.fn(async (on: boolean) => on);
    (window.testimusDesktop as unknown as { setAlwaysOnTop: typeof set }).setAlwaysOnTop = set;
    expect(await setAlwaysOnTop(true)).toBe(true);
    expect(localStorage.getItem("testimus.alwaysOnTop")).toBe("true");
    set.mockClear();
    restoreAlwaysOnTop();
    expect(set).toHaveBeenCalledWith(true);
    localStorage.setItem("testimus.alwaysOnTop", "false");
    set.mockClear();
    restoreAlwaysOnTop();
    expect(set).not.toHaveBeenCalled();
    noDesktop();
    set.mockClear();
    localStorage.setItem("testimus.alwaysOnTop", "true");
    restoreAlwaysOnTop();
    expect(set).not.toHaveBeenCalled();
  });

  it("says when the window refuses, and reads false from a storage that throws", async () => {
    fakeDesktop();
    (window.testimusDesktop as unknown as { setAlwaysOnTop: () => Promise<boolean> }).setAlwaysOnTop = async () => {
      throw new Error("no window");
    };
    render(<Probe />);
    await act(async () => {
      expect(await setAlwaysOnTop(true)).toBe(false);
    });
    expect(screen.getByText("Could not change always on top")).toBeInTheDocument();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readAlwaysOnTop()).toBe(false);
  });

  it("is a pin button only in the desktop shell, following the choice made elsewhere", async () => {
    const { container } = render(<OnTopToggle />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    fakeDesktop();
    const set = vi.fn(async (on: boolean) => on);
    (window.testimusDesktop as unknown as { setAlwaysOnTop: typeof set }).setAlwaysOnTop = set;
    render(<OnTopToggle className="x" />);
    const pin = screen.getByRole("button", { name: "Always on top" });
    expect(pin).toHaveAttribute("aria-pressed", "false");
    expect(pin).toHaveAttribute("title", "Always on top");
    fireEvent.click(pin);
    await waitFor(() => expect(set).toHaveBeenCalledWith(true));
    expect(pin).toHaveAttribute("aria-pressed", "true");
    expect(pin).toHaveClass("ontop-on", "x");
    act(() => {
      window.dispatchEvent(new CustomEvent("testimus:on-top", { detail: "yes" }));
    });
    expect(pin).toHaveAttribute("aria-pressed", "false");
  });
});

describe("ModelPicker", () => {
  it("picks a listed model, or a typed one handed over on Enter or blur only", () => {
    const change = vi.fn();
    const { rerender } = render(<ModelPicker value="sonnet" className="c" onChange={change} />);
    const select = screen.getByRole("combobox", { name: "Model" });
    expect(screen.getByRole("option", { name: "Fable" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "opus" } });
    expect(change).toHaveBeenLastCalledWith("opus");
    fireEvent.change(select, { target: { value: "custom" } });
    const box = screen.getByRole("textbox", { name: "Custom model" });
    expect(box).toHaveValue("");
    fireEvent.blur(box);
    fireEvent.change(box, { target: { value: "bad name!" } });
    expect(box).toHaveAttribute("aria-invalid", "true");
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.change(box, { target: { value: "claude-x-1[1m]" } });
    expect(box).toHaveAttribute("aria-invalid", "false");
    fireEvent.keyDown(box, { key: "a" });
    expect(change).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(change).toHaveBeenLastCalledWith("claude-x-1[1m]");
    rerender(<ModelPicker value="claude-x-1[1m]" className="c" onChange={change} />);
    fireEvent.blur(screen.getByRole("textbox", { name: "Custom model" }));
    expect(change).toHaveBeenCalledTimes(2);
    rerender(<ModelPicker value="haiku" className="c" onChange={change} />);
    expect(screen.queryByRole("textbox", { name: "Custom model" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("haiku");
    rerender(<ModelPicker value="other-1" className="c" onChange={change} />);
    expect(screen.getByRole("textbox", { name: "Custom model" })).toHaveValue("other-1");
  });

  it("is labelled by its own label when it has an id", () => {
    render(
      <>
        <label htmlFor="m">Default model</label>
        <ModelPicker id="m" value="mine" className="c" onChange={() => {}} />
      </>,
    );
    expect(screen.getByRole("combobox", { name: "Default model" })).toHaveValue("custom");
    expect(cap("")).toBe("");
    expect(cap("opus")).toBe("Opus");
  });
});

describe("ConnectClaude, the optional buttons", () => {
  it("offers to set the path, and leaves the system check out when not given", () => {
    const setPath = vi.fn();
    render(
      <ConnectClaude
        status={{ installed: false, signedIn: null }}
        checking={false}
        onCheck={() => {}}
        onSetPath={setPath}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Set the path myself…" }));
    expect(setPath).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Open system check" })).toBeNull();
  });
});

describe("TracesBar", () => {
  const withTraces = (traces?: TraceView[]): Partial<AppState> => {
    const base = app().info as NonNullable<AppState["info"]>;
    return { info: { ...base, traces } };
  };

  it("lists the tracked ids and opens one, or a new one", async () => {
    net.routes["traces.find"] = () => ({ total: 0, distinct: 0, docs: [], items: [] });
    withApp(<TracesBar hint="Nothing tracked yet" />, {
      ...withTraces([
        trace({ found: 2 }),
        trace({ id: "alm", label: "Alarme", field: "Alarme", column: "local", found: 1 }),
      ]),
    });
    expect(screen.queryByText("Nothing tracked yet")).toBeNull();
    const local = screen.getByRole("button", { name: /Alarme · 1 id/ });
    expect(local).toHaveAttribute("title", expect.stringContaining("not in Xray yet"));
    expect(screen.getByRole("button", { name: /Exigence · 2 ids/ })).not.toHaveAttribute(
      "title",
      expect.stringContaining("not in Xray"),
    );
    fireEvent.click(local);
    expect(screen.getByRole("dialog", { name: "Change the tracked Alarme ids" })).toBeInTheDocument();
    await waitFor(() => expect(callsOf("traces.find")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Track ids…/ }));
    expect(screen.getByRole("dialog", { name: "Track ids from the documents" })).toBeInTheDocument();
  });

  it("shows the hint when nothing is tracked or no project is read", () => {
    withApp(<TracesBar hint="Nothing tracked yet" />, withTraces(undefined));
    expect(screen.getByText("Nothing tracked yet")).toBeInTheDocument();
    cleanup();
    withApp(<TracesBar hint="No project" />, { info: null });
    expect(screen.getByText("No project")).toBeInTheDocument();
  });
});
