// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Step, Test } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { ConnectClaude } from "../../src/ui/components/claude/ConnectClaude.tsx";
import { cap, ModelPicker } from "../../src/ui/components/claude/ModelPicker.tsx";
import { OnTopToggle } from "../../src/ui/components/claude/OnTopToggle.tsx";
import { Confirm, Toasts } from "../../src/ui/components/legacy/index.ts";
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
import { closeToast, useToasts } from "../../src/ui/lib/toast.ts";
import { fakeNet } from "./cov-uishell-helpers.tsx";
import { layoutOf } from "./layout-helpers.ts";
import { fakeDesktop, noDesktop } from "./ui-desktop-helpers.tsx";

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
