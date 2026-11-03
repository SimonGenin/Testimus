// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnModes, Step } from "../../src/core/types.ts";
import type { Column } from "../../src/ui/lib/columns.ts";
import { ColumnField } from "../../src/ui/screens/tests/ColumnField.tsx";
import { ColumnsMenu } from "../../src/ui/screens/tests/ColumnsMenu.tsx";
import { GoneStep, WasView } from "../../src/ui/screens/tests/WasView.tsx";
import { layoutOf } from "./layout-helpers.ts";

afterEach(() => {
  cleanup();
});

describe("ColumnField", () => {
  const col = (kind: Column["kind"]): Column => ({ name: "Note", kind, known: true });

  it("edits a line column on one line and a text column freely", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ColumnField column={col("line")} value="a" stepNumber={2} onChange={onChange} />);
    const line = screen.getByLabelText("Note of step 2");
    expect(line.tagName).toBe("INPUT");
    fireEvent.change(line, { target: { value: "x y" } });
    expect(onChange).toHaveBeenLastCalledWith("x y");
    rerender(<ColumnField column={col("text")} value="a" stepNumber={2} onChange={onChange} />);
    const text = screen.getByLabelText("Note of step 2");
    expect(text.tagName).toBe("TEXTAREA");
    fireEvent.change(text, { target: { value: "x\ny" } });
    expect(onChange).toHaveBeenLastCalledWith("x\ny");
  });

  it("hands a single-line column's value on as the input gives it, as Xray Editor does", () => {
    const onChange = vi.fn();
    render(<ColumnField column={col("line")} value="a" stepNumber={2} onChange={onChange} />);
    const line = screen.getByLabelText("Note of step 2");
    expect(line.tagName).toBe("INPUT");
    Object.defineProperty(line, "value", { configurable: true, get: () => "xy z" });
    fireEvent.change(line);
    expect(onChange).toHaveBeenLastCalledWith("xy z");
  });

  it("shows a read-only column, or empty", () => {
    const { rerender } = render(<ColumnField column={col("readonly")} value="42" stepNumber={1} onChange={vi.fn()} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("read-only")).toBeInTheDocument();
    rerender(<ColumnField column={col("readonly")} value="" stepNumber={1} onChange={vi.fn()} />);
    expect(screen.getByText("empty")).toBeInTheDocument();
  });
});

const columns: Column[] = [
  { name: "Action", kind: "blocks", known: true },
  { name: "Data", kind: "blocks", known: true },
  { name: "Note", kind: "text", known: false },
  { name: "Expected Result", kind: "blocks", known: true },
];

const menu = (projectModes: ColumnModes = {}, testModes: ColumnModes | null = null) => {
  const onProject = vi.fn();
  const onTest = vi.fn();
  const r = render(
    <div>
      <span>outside</span>
      <ColumnsMenu
        columns={columns}
        projectModes={projectModes}
        testModes={testModes}
        onProject={onProject}
        onTest={onTest}
      />
    </div>,
  );
  const toggle = () => fireEvent.click(screen.getByRole("button", { name: "Columns" }));
  return { ...r, onProject, onTest, toggle };
};

const row = (name: string) => screen.getByRole("group", { name: `${name} column` });

describe("ColumnsMenu", () => {
  it("is absent when no column can fold", () => {
    const { container } = render(
      <ColumnsMenu
        columns={[columns[0], columns[3]]}
        projectModes={{}}
        testModes={null}
        onProject={vi.fn()}
        onTest={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("sets project modes, dropping a column back to open", () => {
    const { onProject, toggle } = menu({ Data: "collapsed" });
    toggle();
    const dialog = screen.getByRole("dialog", { name: "Step columns" });
    expect(screen.getByRole("button", { name: "Columns" })).toHaveAttribute("aria-controls", dialog.id);
    expect(within(dialog).getByText("not in Xray")).toBeInTheDocument();
    expect(within(dialog).getByText(/Saved in columns.json/)).toBeInTheDocument();
    expect(within(row("Data")).getByRole("button", { name: "collapsed" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(row("Note")).getByRole("button", { name: "when filled" }));
    expect(onProject).toHaveBeenLastCalledWith({ Data: "collapsed", Note: "filled" });
    fireEvent.click(within(row("Data")).getByRole("button", { name: "open" }));
    expect(onProject).toHaveBeenLastCalledWith({});
    expect(screen.queryByRole("button", { name: "use project's" })).toBeNull();
  });

  it("marks a column switched off in Xray, shown when filled unless set open for the project", () => {
    const onProject = vi.fn();
    render(
      <ColumnsMenu
        columns={[...columns, { name: "Retired", kind: "text", known: true, off: true }]}
        projectModes={{}}
        testModes={null}
        onProject={onProject}
        onTest={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getByText("off in Xray")).toBeInTheDocument();
    expect(within(row("Retired")).getByRole("button", { name: "when filled" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(row("Retired")).getByRole("button", { name: "open" }));
    expect(onProject).toHaveBeenLastCalledWith({ Retired: "open" });
    fireEvent.click(within(row("Retired")).getByRole("button", { name: "when filled" }));
    expect(onProject).toHaveBeenLastCalledWith({});
  });

  it("sets test modes on top of the project's, and clears them when they match", () => {
    const { onTest, toggle } = menu({ Data: "filled" });
    toggle();
    fireEvent.click(screen.getByRole("button", { name: "this test" }));
    expect(screen.getByText(/Saved for this test only/)).toBeInTheDocument();
    fireEvent.click(within(row("Data")).getByRole("button", { name: "collapsed" }));
    expect(onTest).toHaveBeenLastCalledWith({ Data: "collapsed" });
    fireEvent.click(within(row("Data")).getByRole("button", { name: "when filled" }));
    expect(onTest).toHaveBeenLastCalledWith(null);
    fireEvent.click(within(row("Note")).getByRole("button", { name: "open" }));
    expect(onTest).toHaveBeenLastCalledWith(null);
  });

  it("opens on the test scope when the test overrides, and resets one or all", () => {
    const { onTest, toggle } = menu({}, { Data: "collapsed", Note: "filled" });
    toggle();
    expect(screen.getByRole("button", { name: "this test" })).toHaveAttribute("aria-pressed", "true");
    expect(within(row("Note")).getByRole("button", { name: "when filled" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getAllByRole("button", { name: "use project's" })[0]);
    expect(onTest).toHaveBeenLastCalledWith({ Note: "filled" });
    fireEvent.click(within(row("Data")).getByRole("button", { name: "when filled" }));
    expect(onTest).toHaveBeenLastCalledWith({ Data: "filled", Note: "filled" });
    fireEvent.click(screen.getByRole("button", { name: "all tests" }));
    expect(screen.getByText(/This test overrides Data, Note/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "follow the project" }));
    expect(onTest).toHaveBeenLastCalledWith(null);
  });

  it("resets the last test override to null", () => {
    const { onTest, toggle } = menu({}, { Data: "collapsed" });
    toggle();
    fireEvent.click(screen.getByRole("button", { name: "use project's" }));
    expect(onTest).toHaveBeenLastCalledWith(null);
  });

  it("closes on Escape, a click outside and the toggle, not on a click inside", () => {
    const { toggle } = menu();
    toggle();
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.mouseDown(screen.getByText("Step columns"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    toggle();
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryByRole("dialog")).toBeNull();
    toggle();
    toggle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

const xray = layoutOf(
  [
    { id: "a", name: "Action", type: "text", builtin: true },
    { id: "d", name: "Data", type: "text", builtin: true },
    { id: "r", name: "Expected Result", type: "text", builtin: true },
    { id: "e", name: "Exigence", type: "text", builtin: false },
    { id: "n", name: "Note", type: "text-single", builtin: false },
  ],
  { order: [], collapsed: [], hidden: [] },
);

const was: Step = {
  id: "11",
  fields: { Action: "![](images/a.png) Open\nmore", "Expected Result": "Opens", Exigence: "EXI_1", Note: "n" },
  sources: [],
  images: [{ file: "images/a.png" }],
};

describe("WasView", () => {
  it("draws the Jira version read-only, skipping empty foldable columns, and opens its images", () => {
    const onOpenImage = vi.fn();
    const onRestore = vi.fn();
    render(
      <WasView
        step={was}
        xray={xray}
        layout="stacked"
        index={0}
        url={(f) => `/u/${f}`}
        restoreLabel="Restore"
        onOpenImage={onOpenImage}
        onRestore={onRestore}
      />,
    );
    const view = screen.getByRole("region", { name: "Step 1 as Jira has it" });
    expect(Array.from(view.querySelectorAll(".fl-k")).map((e) => e.textContent)).toEqual([
      "Action",
      "Expected Result",
      "Exigence",
      "Note",
    ]);
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.getByLabelText("Note of step 1")).toHaveAttribute("readonly");
    fireEvent.click(screen.getByRole("img", { name: "a.png" }));
    expect(onOpenImage).toHaveBeenCalledWith("images/a.png", was.images);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestore).toHaveBeenCalled();
  });

  it("lays columns out side by side without a restore button", () => {
    const { container } = render(
      <WasView step={was} xray={xray} layout="split" index={2} url={(f) => f} restoreLabel="R" onOpenImage={vi.fn()} />,
    );
    const body = container.querySelector(".step-body") as HTMLElement;
    expect(body).toHaveClass("is-split");
    expect(body.style.getPropertyValue("--tracks")).toContain("minmax");
    expect(screen.queryByRole("button", { name: "R" })).toBeNull();
  });
});

describe("GoneStep", () => {
  it("shows a deleted step's first line and its Jira version on demand", () => {
    const onRestore = vi.fn();
    render(
      <GoneStep step={was} xray={xray} layout="stacked" url={(f) => f} onOpenImage={vi.fn()} onRestore={onRestore} />,
    );
    const gone = screen.getByRole("region", { name: "Deleted step" });
    expect(gone.querySelector(".step-line")).toHaveTextContent("Open");
    const toggle = screen.getByRole("button", { name: "Jira version" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Bring the step back" }));
    expect(onRestore).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "hide Jira version" }));
    expect(screen.queryByRole("button", { name: "Bring the step back" })).toBeNull();
  });

  it("copes with a step without Action", () => {
    render(
      <GoneStep step={{ ...was, fields: {} }} xray={xray} layout="stacked" url={(f) => f} onOpenImage={vi.fn()} />,
    );
    expect(screen.getByRole("region", { name: "Deleted step" }).querySelector(".step-line")).toHaveTextContent("");
  });
});
