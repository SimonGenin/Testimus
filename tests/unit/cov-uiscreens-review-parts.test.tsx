// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Finding, Step, Test } from "../../src/core/types.ts";
import { EvidenceBlock } from "../../src/ui/screens/review/EvidenceBlock.tsx";
import { FixNote } from "../../src/ui/screens/review/FixNote.tsx";
import { type QueueItem, ReviewQueue } from "../../src/ui/screens/review/ReviewQueue.tsx";
import { FindingSources, findingSummary, ReviewStep } from "../../src/ui/screens/review/ReviewStep.tsx";
import { ReviewTest } from "../../src/ui/screens/review/ReviewTest.tsx";
import { SourcePanel } from "../../src/ui/screens/review/SourcePanel.tsx";
import { mount } from "./cov-uiscreens-helpers.tsx";
import { layoutOf } from "./layout-helpers.ts";
import { api, fakeFetch } from "./ui-desktop-helpers.tsx";

beforeEach(() => {
  fakeFetch();
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
  it("requires a note, submits with Enter or the button, cancels with Escape", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<FixNote id="T-1" initial="" claudeReady onCancel={onCancel} onSubmit={onSubmit} />);
    const dlg = screen.getByRole("dialog", { name: "Mark as To fix" });
    const area = screen.getByLabelText(/Note for the author/);
    expect(area).toHaveFocus();
    fireEvent.keyDown(dlg, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("the note is required");
    expect(area).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(area, { target: { value: " Fix step 2 " } });
    fireEvent.keyDown(dlg, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.keyDown(dlg, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("Fix step 2", false);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Mark To fix/ }));
    expect(onSubmit).toHaveBeenLastCalledWith("Fix step 2", true);
    fireEvent.keyDown(dlg, { key: "a" });
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("without Claude the box is off and the note is kept for later", () => {
    const onSubmit = vi.fn();
    render(<FixNote id="T-1" initial="old note" claudeReady={false} onCancel={vi.fn()} onSubmit={onSubmit} />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByText(/the note is kept for later/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Mark To fix/ }));
    expect(onSubmit).toHaveBeenCalledWith("old note", false);
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
        item("b", { summary: "", folder: "", errors: 1, warnings: 1, infos: 1, stale: true }),
        item("c"),
        item("d", { unchecked: true }),
      ],
      counts: { checked: 1, toFix: 2, draft: 3, unchecked: 0 },
      activeId: "b",
      folder: "/A",
    });
    render(<ReviewQueue {...p} />);
    const seg = screen.getByRole("group", { name: "Filter by review state" });
    expect(within(seg).getByRole("button", { name: /All/ })).toHaveTextContent("6");
    fireEvent.click(within(seg).getByRole("button", { name: /To fix/ }));
    expect(p.onFilter).toHaveBeenCalledWith("to-fix");
    const rows = screen.getAllByRole("button", { name: /Not in Jira yet|K-1/ });
    expect(rows[0]).toHaveTextContent("1 error");
    expect(rows[0]).toHaveTextContent("2 warnings");
    expect(rows[0]).toHaveTextContent("3 notes");
    expect(rows[1]).toHaveTextContent("Untitled test");
    expect(rows[1]).toHaveAttribute("aria-current", "true");
    expect(rows[1].querySelectorAll(".s-stale")).toHaveLength(3);
    expect(rows[2]).toHaveTextContent("No findings");
    fireEvent.click(rows[2]);
    expect(p.onOpen).toHaveBeenCalledWith("c");
    expect(rows[3]).toHaveTextContent("Not checked yet");
    fireEvent.click(screen.getByRole("button", { name: /Most issues first/ }));
    const sortMenu = screen.getByRole("menu", { name: "Sort the queue" });
    fireEvent.click(within(sortMenu).getByRole("menuitem", { name: "By folder" }));
    expect(p.onSort).toHaveBeenCalledWith("folder");
    fireEvent.click(screen.getByRole("button", { name: /Most issues first/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Only tests with findings" }));
    expect(p.onWithFindings).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "/A" }));
    const folderMenu = screen.getByRole("menu", { name: "Filter by folder" });
    fireEvent.click(within(folderMenu).getByRole("menuitem", { name: "/B" }));
    expect(p.onFolder).toHaveBeenCalledWith("/B");
    fireEvent.click(screen.getByRole("button", { name: "/A" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "All folders" }));
    expect(p.onFolder).toHaveBeenCalledWith("");
  });

  it("loading, empty and filtered-empty states", () => {
    const { rerender } = render(<ReviewQueue {...props({ items: null })} />);
    expect(screen.getByRole("status", { name: "Loading the queue" })).toBeInTheDocument();
    rerender(<ReviewQueue {...props()} />);
    expect(screen.getByText(/Generated tests land here once written/)).toBeInTheDocument();
    rerender(<ReviewQueue {...props({ withFindings: true })} />);
    expect(screen.getByText("No test matches these filters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /With findings/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /With findings/ }));
    expect(screen.getByRole("menuitem", { name: "Only tests with findings" })).toHaveAttribute("aria-current", "true");
    rerender(<ReviewQueue {...props({ folder: "/A" })} />);
    expect(screen.getByText("No test matches these filters.")).toBeInTheDocument();
    rerender(<ReviewQueue {...props({ filter: "checked" })} />);
    expect(screen.getByText("No test matches these filters.")).toBeInTheDocument();
  });
});

describe("ReviewStep", () => {
  it("findingSummary counts by severity", () => {
    expect(findingSummary([finding({ severity: "info" })])).toEqual({ tone: "info", text: "1 note" });
    expect(findingSummary([])).toEqual({ tone: "ok", text: "No findings" });
    expect(findingSummary([finding()])).toEqual({ tone: "warning", text: "1 warning" });
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

  it("folded: first line of the first field, Claude badge, empty step, expand", () => {
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
    expect(screen.getByText("1 note").closest(".sev")).toHaveClass("s-stale");
    fireEvent.click(screen.getByRole("button", { name: "Expand step 2" }));
    expect(p.onFold).toHaveBeenCalledWith(false);
    rerender(<ReviewStep {...base({ folded: true, step: step({}), xray: { ...xray, fields: [] } })} />);
    expect(screen.getByText("Empty step")).toBeInTheDocument();
  });

  it("open: fields, folded empty field, a smart column as text, sources, findings and folding", () => {
    const p = base({
      active: true,
      claude: true,
      step: step(
        { Action: "Ouvrir", "Expected Result": "", Exigence: "EXI_1, EXI_2, EXI_3" },
        { sources: [{ docId: "D", anchor: "§1", quote: "q" }] },
      ),
      selected: "D#§1",
      findings: [
        finding({ kind: "source-missing", message: "EXI_3 here", pass: "semantic" }),
        finding({ kind: "source-missing", message: "mech", pass: "mechanical", sources: ["D#§9"] }),
      ],
    });
    render(<ReviewStep {...p} />);
    const art = screen.getByRole("article", { name: "Step 2" });
    expect(art).toHaveClass("is-active", "has-findings");
    expect(within(art).getByText("Changed by Claude")).toBeInTheDocument();
    expect(within(art).getByText("Folded · empty")).toBeInTheDocument();
    expect(art.querySelector('[data-field="Expected Result"]')).toBeNull();
    expect(art.querySelector('[data-field="Exigence"]')).toHaveTextContent("EXI_1, EXI_2, EXI_3");
    expect(art.querySelector('[data-field="Exigence"] .chip')).toBeNull();
    expect(screen.getAllByText("No passage was found for it.")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /D §1/ }));
    expect(p.onSelect).toHaveBeenCalledWith({ docId: "D", anchor: "§1", quote: "q" }, 2);
    fireEvent.click(screen.getByRole("button", { name: /D §9/ }));
    expect(p.onSelect).toHaveBeenLastCalledWith({ docId: "D", anchor: "§9", quote: "" }, 2);
    fireEvent.click(screen.getByRole("button", { name: "Fold step 2" }));
    expect(p.onFold).toHaveBeenCalledWith(true);
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
      steps: [step({ Action: "a", Exigence: "EXI_MOP_1, EXI_MOP_2" }), step({ Action: "b" })],
      extra: {},
      ...over,
    }) as Test;
  const props = (over: Partial<Parameters<typeof ReviewTest>[0]> = {}) => ({
    test: test(),
    sync: "synced" as const,
    check: { at: "", testHash: "", findings: [] as Finding[] },
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
      check: {
        at: "",
        testHash: "",
        findings: [finding({ message: "Whole one", sources: ["D#§1"] }), finding({ step: 9, message: "Beyond" })],
      },
      folded: new Set([0, 1]),
      activeStep: 1,
    });
    render(<ReviewTest {...p} />);
    expect(screen.getByText("K-1")).toBeInTheDocument();
    expect(screen.getAllByText("Whole test")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /D §1/ }));
    expect(p.onSelect).toHaveBeenCalledWith({ docId: "D", anchor: "§1", quote: "" }, null);
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
    expect(screen.getByRole("article", { name: "Step 2" })).not.toHaveClass("rstep-folded");
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
    const { rerender } = render(<ReviewTest {...p} />);
    expect(screen.getByText("Not in Jira yet")).toBeInTheDocument();
    expect(screen.getByText("Untitled test")).toBeInTheDocument();
    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
    expect(screen.getByText("This test has no steps yet.")).toBeInTheDocument();
    expect(screen.getByText("Claude changed 1 step")).toBeInTheDocument();
    expect(screen.getByText(/waiting for the check/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(p.onRevert).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revert anyway" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep the test as it is" }));
    expect(onRevertAnyway).toHaveBeenCalled();
    expect(onKeepAfterRun).toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "Claude's fix" })).toHaveTextContent("Still wrong");
    expect(screen.getByRole("note", { name: "To fix note" })).toHaveTextContent("To fix · Ana");
    expect(screen.getByRole("button", { name: "Unfold all" })).toBeInTheDocument();
    rerender(
      <ReviewTest
        {...props({ test: test({ review: "to-fix", reviewNote: "n" } as Partial<Test>), marks, claudeRunning: true })}
      />,
    );
    expect(screen.getByText(/Claude is fixing this test/)).toBeInTheDocument();
    expect(screen.queryByText(/Claude changed/)).toBeNull();
    expect(screen.getByRole("note", { name: "To fix note" })).toHaveTextContent(/^To fixn$/);
    rerender(<ReviewTest {...props({ marks })} />);
    expect(screen.getByText(/re-checked/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fold all" }));
    rerender(<ReviewTest {...props({ marks, revertConflict: "x" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Revert anyway" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep the test as it is" }));
  });
});

describe("SourcePanel and EvidenceBlock", () => {
  const passage = {
    docId: "D",
    anchor: "§1",
    path: "1",
    title: "One",
    text: "Le texte avec la citation.",
    figures: [],
    doc: { code: "C-D", title: "Doc D", version: "2", status: "validated" },
  };

  it("shows a passage, its count, opens the document and closes", async () => {
    api.routes["rag.passage"] = () => passage;
    const onOpenDoc = vi.fn();
    const onClose = vi.fn();
    mount(
      <SourcePanel
        source={{ docId: "D", anchor: "§1", quote: "citation" }}
        label="Source of step 1"
        index={0}
        total={1}
        testId=""
        onClose={onClose}
        onOpenDoc={onOpenDoc}
        onPick={vi.fn()}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Doc D" })).toBeInTheDocument();
    expect(screen.getByText("C-D · v2")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 source")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sources read" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open in document" }));
    expect(onOpenDoc).toHaveBeenCalledWith("D", "§1", "citation");
    fireEvent.click(screen.getByRole("button", { name: "Close the source" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("an unreadable passage shows the quote; no count without sources", async () => {
    mount(
      <SourcePanel
        source={{ docId: "D", anchor: "§1", quote: "" }}
        label="L"
        index={0}
        total={0}
        testId=""
        onClose={vi.fn()}
        onOpenDoc={vi.fn()}
        onPick={vi.fn()}
      />,
    );
    expect(await screen.findByText("This passage could not be shown.")).toBeInTheDocument();
    expect(screen.queryByText(/«/)).toBeNull();
    expect(screen.queryByText(/of 0/)).toBeNull();
  });

  it("a source whose document was deleted says so, with its quote, and hides Open in document", async () => {
    api.routes["docs.list"] = () => [];
    mount(
      <SourcePanel
        source={{ docId: "GONE", anchor: "§1", quote: "le texte cité" }}
        label="L"
        index={0}
        total={1}
        testId=""
        onClose={vi.fn()}
        onOpenDoc={vi.fn()}
        onPick={vi.fn()}
      />,
    );
    expect(await screen.findByText("Document deleted")).toBeInTheDocument();
    expect(screen.getByText(/add GONE again/)).toBeInTheDocument();
    expect(screen.getByText("« le texte cité »")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open in document" })).toBeNull();
  });

  it("ignores a passage that arrives after the source changed", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    api.routes["rag.passage"] = (i) => ({ ...passage, doc: { ...passage.doc, title: String(i.ref) } });
    const f = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(init?.body).includes("A#")) await gate;
        return f(url, init);
      }),
    );
    const props = { label: "L", index: 0, total: 0, testId: "", onClose: vi.fn(), onOpenDoc: vi.fn(), onPick: vi.fn() };
    const { rerender } = mount(<SourcePanel {...props} source={{ docId: "A", anchor: "1", quote: "" }} />);
    rerender(<SourcePanel {...props} source={{ docId: "B", anchor: "2", quote: "" }} />);
    expect(await screen.findByRole("heading", { name: "B#2" })).toBeInTheDocument();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole("heading", { name: "B#2" })).toBeInTheDocument();
  });

  it("evidence: loading, what was read, toggling, and late answers ignored", async () => {
    api.routes["review.evidence"] = () => ({
      testId: "T",
      jobId: "j",
      consulted: [],
      read: [
        { ref: "D#§1", title: "", cited: false },
        { ref: "D#§2", title: "Two", cited: true },
      ],
      searched: [],
    });
    const onPick = vi.fn();
    const { rerender } = render(<EvidenceBlock testId="T" selected="D#§2" onPick={onPick} />);
    const head = screen.getByRole("button", { name: /Sources read/ });
    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("2 read")).toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
    expect(screen.getByText("Cited")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /D#§2/ })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: /D#§1/ }));
    expect(onPick).toHaveBeenCalledWith("D#§1");
    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "false");
    rerender(<EvidenceBlock testId="" selected="" onPick={onPick} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Sources read/ }).querySelector(".ev-sum")).toBeNull(),
    );
  });

  it("evidence: shows a skeleton inside while loading", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    api.routes["review.evidence"] = () => ({
      testId: "T",
      jobId: "j",
      consulted: [],
      read: [],
      searched: [],
    });
    const f = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        await gate;
        return f(url, init);
      }),
    );
    const { container, unmount } = render(<EvidenceBlock testId="T" selected="" onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Sources read/ }));
    expect(container.querySelector("#ev-body")?.children.length).toBe(1);
    unmount();
    release();
    await new Promise((r) => setTimeout(r, 20));
  });
});
