// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Finding, Step, Test } from "../../../../src/core/types.ts";
import { createQueryClient } from "../../../../src/ui/lib/data/query.ts";
import { FixNote } from "../../../../src/ui/screens/review/FixNote.tsx";
import { type QueueItem, ReviewQueue } from "../../../../src/ui/screens/review/ReviewQueue.tsx";
import { FindingSources, findingSummary, ReviewStep } from "../../../../src/ui/screens/review/ReviewStep.tsx";
import { ReviewTest } from "../../../../src/ui/screens/review/ReviewTest.tsx";
import { layoutOf } from "../../helpers/layout.ts";
import { choose } from "../../helpers/select.ts";
import { fakeServer } from "./helpers.tsx";

beforeEach(() => {
  fakeServer();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const xray = layoutOf(
  [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "data", name: "Data", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
    { id: "cf", name: "Exigence", type: "text", builtin: false },
  ],
  { order: ["Action", "Data", "Expected Result", "Exigence"], collapsed: ["Data"], hidden: [] },
);

// the banner of a Claude run reads the running jobs (its « Cancel the run »)
const Data = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>
);

const finding = (over: Partial<Finding> = {}): Finding => ({
  kind: "source-missing",
  severity: "warning",
  message: "m",
  sources: [],
  ...over,
});

const step = (fields: Record<string, string>, over: Partial<Step> = {}): Step => ({
  fields,
  sources: [],
  images: [],
  ...over,
});

describe("FixNote", () => {
  it("requires a note, marks with Ctrl+Enter or the button, asks Claude, cancels with Escape or Cancel", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<FixNote id="T-1" initial="" claudeReady onCancel={onCancel} onSubmit={onSubmit} />);
    const dlg = screen.getByRole("dialog", { name: "What needs fixing?" });
    const area = screen.getByLabelText(/Note for the author/);
    expect(area).toHaveFocus();
    fireEvent.keyDown(area, { key: "Enter", ctrlKey: true });
    expect(area).toHaveAccessibleDescription(/Say what is wrong: the note is required\./);
    expect(area).toHaveAttribute("aria-invalid", "true");
    expect(within(dlg).getByRole("button", { name: /Mark To fix/ })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(area, { target: { value: " Fix step 2 " } });
    expect(within(dlg).getByText("Draft kept")).toBeInTheDocument();
    fireEvent.keyDown(area, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(area, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledWith("Fix step 2", false);
    fireEvent.change(area, { target: { value: "Fix step 2" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Ask Claude to fix it" }));
    expect(onSubmit).toHaveBeenLastCalledWith("Fix step 2", true);
    fireEvent.change(area, { target: { value: "Fix step 2" } });
    fireEvent.click(within(dlg).getByRole("button", { name: /Mark To fix/ }));
    expect(onSubmit).toHaveBeenLastCalledWith("Fix step 2", false);
    fireEvent.keyDown(dlg, { key: "a" });
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("without Claude Ask Claude is off and says why; the note is kept for later", () => {
    const onSubmit = vi.fn();
    render(<FixNote id="T-2" initial="old note" claudeReady={false} onCancel={vi.fn()} onSubmit={onSubmit} />);
    const ask = screen.getByRole("button", { name: "Ask Claude to fix it" });
    expect(ask).toBeDisabled();
    expect(ask).toHaveAccessibleDescription(/the note is kept for later/);
    expect(screen.queryByText("Draft kept")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Mark To fix/ }));
    expect(onSubmit).toHaveBeenCalledWith("old note", false);
  });

  it("keeps the note of a test the user left, and forgets it on Cancel", () => {
    const props = { claudeReady: true, onCancel: vi.fn(), onSubmit: vi.fn() };
    const r = render(<FixNote id="T-3" initial="" {...props} />);
    fireEvent.change(screen.getByLabelText(/Note for the author/), { target: { value: "step 2 is wrong" } });
    r.unmount();
    const again = render(<FixNote id="T-3" initial="" {...props} />);
    expect(screen.getByLabelText(/Note for the author/)).toHaveValue("step 2 is wrong");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    again.unmount();
    render(<FixNote id="T-3" initial="" {...props} />);
    expect(screen.getByLabelText(/Note for the author/)).toHaveValue("");
  });
});

describe("ReviewQueue", () => {
  const item = (id: string, over: Partial<QueueItem> = {}): QueueItem => ({
    id,
    summary: id,
    folder: "/F",
    review: "checked",
    unchecked: false,
    errors: 0,
    warnings: 0,
    infos: 0,
    stale: false,
    mtime: 1,
    ...over,
  });
  const props = (over: Partial<Parameters<typeof ReviewQueue>[0]> = {}) => ({
    items: [] as QueueItem[] | null,
    counts: null,
    activeId: "",
    filter: "all" as const,
    sort: "anomalies" as const,
    folder: "",
    folders: ["/A", "/B"],
    withFindings: false,
    onFilter: vi.fn(),
    onSort: vi.fn(),
    onFolder: vi.fn(),
    onWithFindings: vi.fn(),
    onOpen: vi.fn(),
    ...over,
  });

  it("shows counts, sorts, filters by folder and by findings", () => {
    const p = props({
      items: [
        item("a", { key: "K-1", errors: 1, warnings: 2, infos: 3 }),
        item("b", { summary: "", folder: "", errors: 1, warnings: 1, infos: 1, stale: true, edited: true }),
        item("c"),
        item("d", { unchecked: true }),
      ],
      counts: { checked: 1, toFix: 2, draft: 3, unchecked: 0, validated: 4 },
      activeId: "b",
      folder: "/A",
    });
    render(<ReviewQueue {...p} />);
    const seg = screen.getByRole("radiogroup", { name: "Filter by review state" });
    expect(within(seg).getByRole("radio", { name: /All/ })).toHaveTextContent("6");
    expect(within(seg).getByRole("radio", { name: /Validated/ })).toHaveTextContent("4");
    fireEvent.click(within(seg).getByRole("radio", { name: /To fix/ }));
    expect(p.onFilter).toHaveBeenCalledWith("to-fix");
    const rows = within(screen.getByRole("listbox", { name: "Tests to review" })).getAllByRole("option");
    expect(rows[0]).toHaveTextContent("1 error");
    expect(rows[0]).toHaveTextContent("2 warnings");
    expect(rows[0]).toHaveTextContent("3 info");
    expect(within(rows[0]).getByRole("tooltip", { hidden: true })).toHaveTextContent("K-1 — a — /F");
    expect(rows[1]).toHaveTextContent("Untitled test");
    expect(rows[1]).toHaveTextContent("Changed since its check");
    expect(within(rows[1]).getByRole("tooltip", { hidden: true })).toHaveTextContent(
      "Not in Jira yet — Untitled test — / · edited since it was generated",
    );
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    expect(rows[2]).toHaveTextContent("No findings");
    fireEvent.click(rows[2]);
    expect(p.onOpen).toHaveBeenCalledWith("c");
    expect(rows[3]).toHaveTextContent("Not checked yet");
    choose(screen.getByRole("combobox", { name: "Sort the queue" }), "Folder");
    expect(p.onSort).toHaveBeenCalledWith("folder");
    fireEvent.click(screen.getByRole("checkbox", { name: "Only with findings" }));
    expect(p.onWithFindings).toHaveBeenCalledWith(true);
    const folder = screen.getByRole("combobox", { name: "Filter by folder" });
    expect(folder).toHaveTextContent("/A");
    choose(folder, "/B");
    expect(p.onFolder).toHaveBeenCalledWith("/B");
    choose(folder, "All folders");
    expect(p.onFolder).toHaveBeenCalledWith("");
  });

  it("loading, empty and filtered-empty states", () => {
    const { rerender } = render(<ReviewQueue {...props({ items: null })} />);
    expect(screen.getByRole("listbox", { name: "Tests to review" })).toHaveAttribute("aria-busy", "true");
    rerender(<ReviewQueue {...props()} />);
    expect(screen.getByText(/Generated tests land here once written/)).toBeInTheDocument();
    rerender(<ReviewQueue {...props({ withFindings: true })} />);
    expect(screen.getByText("No test matches these filters.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Only with findings" })).toBeChecked();
    rerender(<ReviewQueue {...props({ folder: "/A" })} />);
    expect(screen.getByText("No test matches these filters.")).toBeInTheDocument();
    rerender(<ReviewQueue {...props({ filter: "checked" })} />);
    expect(screen.getByText("No test matches these filters.")).toBeInTheDocument();
    rerender(<ReviewQueue {...props({ filter: "validated" })} />);
    expect(screen.getByText("No generated test validated yet")).toBeInTheDocument();
    expect(screen.getByText(/stays readable here once validated/)).toBeInTheDocument();
  });

  it("Check all runs the check on the tests that need it, and says when none does", () => {
    const onCheck = vi.fn();
    const { rerender } = render(<ReviewQueue {...props({ checkAll: { ids: ["a"], running: false, onCheck } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Check all" }));
    expect(onCheck).toHaveBeenCalled();
    rerender(<ReviewQueue {...props({ checkAll: { ids: [], running: false, onCheck } })} />);
    const off = screen.getByRole("button", { name: "Check all" });
    expect(off).toBeDisabled();
    expect(off).toHaveAccessibleDescription(/checked and up to date/);
    rerender(<ReviewQueue {...props({ checkAll: { ids: ["a"], running: true, onCheck } })} />);
    expect(screen.getByRole("button", { name: "Check all" })).toHaveAttribute("aria-busy", "true");
  });
});

describe("ReviewStep", () => {
  it("findingSummary counts by severity", () => {
    expect(findingSummary([finding({ severity: "info" })])).toEqual({ tone: "info", text: "1 info" });
    expect(findingSummary([])).toEqual({ tone: "ok", text: "No findings" });
    expect(findingSummary([finding()])).toEqual({ tone: "warning", text: "1 warning" });
    expect(findingSummary([finding({ severity: "error" }), finding()])).toEqual({ tone: "error", text: "1 error" });
  });

  it("FindingSources renders nothing without a parsable source", () => {
    const { container } = render(
      <FindingSources finding={finding({ sources: ["not a ref"] })} selected="" onSelect={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  const base = (over: Partial<Parameters<typeof ReviewStep>[0]> = {}) => ({
    n: 2,
    step: step({ Action: "Ouvrir" }),
    xray,
    findings: [] as Finding[],
    stale: false,
    folded: false,
    active: false,
    selected: "",
    url: (f: string) => `/u/${f}`,
    onFold: vi.fn(),
    onSelect: vi.fn(),
    onOpenImage: vi.fn(),
    ...over,
  });

  it("folded: first line of the first field, Claude badge, out-of-date count, empty step, unfold", () => {
    const p = base({
      folded: true,
      claude: true,
      added: true,
      stale: true,
      findings: [finding({ severity: "info" })],
      step: step({ Action: "![](img.png)\nLine one\nLine two" }),
    });
    const { rerender } = render(<ReviewStep {...p} />);
    expect(screen.getByText("Line one")).toBeInTheDocument();
    expect(screen.getByText("Added by Claude")).toBeInTheDocument();
    expect(screen.getByText("1 info")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand step 2" }));
    expect(p.onFold).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByText("Line one"));
    expect(p.onFold).toHaveBeenCalledTimes(1);
    rerender(<ReviewStep {...base({ folded: true, step: step({}), xray: { ...xray, fields: [] } })} />);
    expect(screen.getByText("Empty step")).toBeInTheDocument();
    expect(screen.getByText("No findings")).toBeInTheDocument();
  });

  it("open: fields, folded empty field, a smart column as text, sources, findings and folding", () => {
    const p = base({
      active: true,
      claude: true,
      step: step(
        { Action: "Ouvrir", "Expected Result": "", Exigence: "EXI_1, EXI_2, EXI_3" },
        { sources: [{ docId: "D", anchor: "§1", quote: "q" }] },
      ),
      selected: "s2:D#§1|q",
      findings: [
        finding({ kind: "source-missing", message: "EXI_3 here", pass: "semantic" }),
        finding({ kind: "source-missing", message: "mech", pass: "mechanical", sources: ["D#§9"] }),
      ],
    });
    render(<ReviewStep {...p} />);
    const art = screen.getByRole("article", { name: "Step 2" });
    expect(art).toHaveAttribute("aria-current", "step");
    expect(within(art).getByText("Changed by Claude")).toBeInTheDocument();
    expect(within(art).getByText("Folded · empty")).toBeInTheDocument();
    expect(within(art).queryByText("2 warnings")).toBeNull();
    expect(art.querySelector('[data-field="Expected Result"]')).toBeNull();
    expect(art.querySelector('[data-field="Exigence"]')).toHaveTextContent("EXI_1, EXI_2, EXI_3");
    expect(within(art.querySelector('[data-field="Exigence"]') as HTMLElement).queryByRole("button")).toBeNull();
    expect(within(art).getAllByRole("note", { name: "Warning · Source missing" })[0]).toHaveTextContent(
      "Step 2 · read by Claude",
    );
    expect(within(art).getAllByRole("note", { name: "Warning · Source missing" })[1]).toHaveTextContent(
      "Step 2 · mechanical check",
    );
    expect(screen.getAllByText("No passage was found for it.")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /D §1/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /D §9/ })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /D §1/ }));
    expect(p.onSelect).toHaveBeenCalledWith({ docId: "D", anchor: "§1", quote: "q" }, 2);
    fireEvent.click(screen.getByRole("button", { name: /D §9/ }));
    expect(p.onSelect).toHaveBeenLastCalledWith({ docId: "D", anchor: "§9", quote: "" }, 2, 1);
    fireEvent.click(screen.getByRole("button", { name: "Fold step 2" }));
    expect(p.onFold).toHaveBeenCalledWith(true);
  });

  it("a step without its own source says so; an out-of-date finding says to check again", () => {
    render(<ReviewStep {...base({ stale: true, findings: [finding({ severity: "error", message: "Wrong" })] })} />);
    expect(screen.getByText("No source")).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Out of date · Error · Source missing" })).toHaveTextContent(
      "Run the check again to confirm.",
    );
  });
});

describe("ReviewTest", () => {
  const test = (over: Partial<Test> = {}): Test =>
    ({
      key: "K-1",
      summary: "Sectionneur",
      folder: "/F",
      labels: [],
      description: "",
      covers: [],
      preconditions: [],
      review: "checked",
      generatedBy: "claude",
      steps: [step({ Action: "a", Exigence: "EXI_MOP_1, EXI_MOP_2" }), step({ Action: "b" })],
      extra: {},
      ...over,
    }) as Test;
  const props = (over: Partial<Parameters<typeof ReviewTest>[0]> = {}) => ({
    test: test(),
    sync: "synced" as const,
    check: { at: "2026-10-30T10:02:00Z", testHash: "", findings: [] as Finding[] },
    stale: false,
    xray,
    folded: new Set<number>(),
    activeStep: -1,
    selected: "",
    marks: null,
    claudeRunning: false,
    url: (f: string) => f,
    onFold: vi.fn(),
    onFoldAll: vi.fn(),
    onSelect: vi.fn(),
    onOpenImage: vi.fn(),
    onEdit: vi.fn(),
    onRevert: vi.fn(),
    onCompare: vi.fn(),
    onTakeJira: vi.fn(),
    onKeepMine: vi.fn(),
    ...over,
  });

  it("head, remote change, whole-test findings and step folding", () => {
    const p = props({
      sync: "remote-changed",
      edited: true,
      check: {
        at: "2026-10-30T10:02:00Z",
        testHash: "",
        findings: [finding({ message: "Whole one", sources: ["D#§1"] }), finding({ step: 9, message: "Beyond" })],
      },
      folded: new Set([0, 1]),
      activeStep: 1,
    });
    render(<ReviewTest {...p} />);
    expect(screen.getByText("K-1")).toBeInTheDocument();
    expect(screen.getByText("/F")).toBeInTheDocument();
    expect(screen.getByText("Generated · edited")).toBeInTheDocument();
    expect(screen.getByText("Changed in Jira")).toBeInTheDocument();
    expect(screen.getByText(/^2 steps · checked 30 Oct/)).toBeInTheDocument();
    expect(screen.getAllByText("Whole test")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /D §1/ }));
    expect(p.onSelect).toHaveBeenCalledWith({ docId: "D", anchor: "§1", quote: "" }, null, 0);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    fireEvent.click(screen.getByRole("button", { name: "Take Jira's version" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(p.onCompare).toHaveBeenCalled();
    expect(p.onTakeJira).toHaveBeenCalled();
    expect(p.onKeepMine).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Unfold all" }));
    expect(p.onFoldAll).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Expand step 1" }));
    expect(p.onFold).toHaveBeenCalledWith(0, false);
    expect(screen.getByRole("button", { name: "Fold step 2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(p.onEdit).toHaveBeenCalled();
  });

  it("Claude running, marks with a revert and its conflict, fix message, to-fix note", () => {
    const onRevertAnyway = vi.fn();
    const onKeepAfterRun = vi.fn();
    const marks = { runId: "r", steps: new Set([1]), added: new Set([1]) };
    const p = props({
      test: test({
        key: undefined,
        folder: "",
        summary: "",
        review: "to-fix",
        reviewNote: "Fix it",
        reviewedBy: "Ana",
        steps: [],
      } as Partial<Test>),
      check: null,
      marks,
      revertConflict: "edited since",
      onRevertAnyway,
      onKeepAfterRun,
      fixMessage: "Still wrong",
    });
    const { rerender } = render(<ReviewTest {...p} />, { wrapper: Data });
    expect(screen.getByText("Not in Jira yet")).toBeInTheDocument();
    expect(screen.getByText("Untitled test")).toBeInTheDocument();
    expect(screen.getByText(/not checked yet · marked by Ana/)).toBeInTheDocument();
    expect(screen.getByText("This test has no steps yet.")).toBeInTheDocument();
    expect(screen.getByText("Claude changed 1 step")).toBeInTheDocument();
    expect(screen.getByText(/it stays To fix until you validate it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(p.onRevert).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revert anyway" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep the test as it is" }));
    expect(onRevertAnyway).toHaveBeenCalled();
    expect(onKeepAfterRun).toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "Claude's fix" })).toHaveTextContent("Still wrong");
    expect(screen.getByRole("note", { name: "To fix note" })).toHaveTextContent("To fix — Ana");
    expect(screen.getByRole("note", { name: "To fix note" })).toHaveTextContent("Fix it");
    expect(screen.getByRole("button", { name: "Fold all" })).toBeInTheDocument();
    rerender(
      <ReviewTest
        {...props({ test: test({ review: "to-fix", reviewNote: "n" } as Partial<Test>), marks, claudeRunning: true })}
      />,
    );
    expect(screen.getByText("Claude is fixing this test")).toBeInTheDocument();
    expect(screen.queryByText(/Claude changed/)).toBeNull();
    expect(screen.getByRole("note", { name: "To fix note" })).toHaveTextContent(/^To fixn$/);
    rerender(<ReviewTest {...props({ marks })} />);
    expect(screen.getByText(/Checked again after the change/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fold all" }));
    rerender(<ReviewTest {...props({ marks, revertConflict: "x" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Revert anyway" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep the test as it is" }));
  });

  it("the check not run or out of date offers it, never while Claude works on the test", () => {
    const onCheck = vi.fn();
    const { rerender } = render(<ReviewTest {...props({ check: null, onCheck })} />, { wrapper: Data });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(onCheck).toHaveBeenCalled();
    rerender(<ReviewTest {...props({ stale: true, onCheck, checking: true })} />);
    expect(screen.getByText("Changed since its check")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toHaveAttribute("aria-busy", "true");
    rerender(<ReviewTest {...props({ stale: true, onCheck, claudeRunning: true })} />);
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  });
});
