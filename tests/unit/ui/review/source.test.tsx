// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Finding } from "../../../../src/core/types.ts";
import { EvidenceBlock } from "../../../../src/ui/screens/review/EvidenceBlock.tsx";
import { notAtAnchor, SourcePanel } from "../../../../src/ui/screens/review/SourcePanel.tsx";
import { fakeServer, mountReview, named, net, refused } from "./helpers.tsx";

beforeEach(() => {
  fakeServer();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const passage = {
  docId: "D1",
  anchor: "§5.2",
  path: "5 > 5.2",
  title: "Sectionneur",
  text: "Le sectionneur est ouvert par l'opérateur depuis le poste.",
  figures: [],
  doc: { code: "D401", version: "3", title: "Spécification", status: "validated" },
};

const evidence = {
  testId: "local-1",
  jobId: "generate-1",
  consulted: ["D1#§5.2", "D1#§5.3"],
  read: [
    { ref: "D1#§5.2", title: "Sectionneur", cited: true },
    { ref: "D1#§5.3", title: "Disjoncteur", cited: false },
  ],
  searched: [{ tool: "rag_search", query: "sectionneur" }],
};

const panel = (props: Partial<Parameters<typeof SourcePanel>[0]> = {}) =>
  mountReview(
    <SourcePanel
      source={{ docId: "D1", anchor: "§5.2", quote: "ouvert par l'opérateur" }}
      label="Source of step 1"
      index={0}
      total={1}
      testId="local-1"
      onClose={vi.fn()}
      onOpenDoc={vi.fn()}
      onPick={vi.fn()}
      {...props}
    />,
  );

const sourcesRead = () => screen.getByRole("button", { name: /^Sources read/ });

describe("Review › the source panel", () => {
  it("shows a passage, its document, its count, opens the document, steps through the sources and closes", async () => {
    net.routes["rag.passage"] = () => passage;
    const onOpenDoc = vi.fn();
    const onClose = vi.fn();
    const onStep = vi.fn();
    panel({ testId: "", total: 3, index: 1, onOpenDoc, onClose, onStep });
    expect(await screen.findByRole("heading", { name: "Spécification" })).toBeInTheDocument();
    expect(screen.getByText("D401")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText("D1#§5.2")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 sources")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Sources read/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open in document" }));
    expect(onOpenDoc).toHaveBeenCalledWith("D1", "§5.2", "ouvert par l'opérateur");
    fireEvent.click(screen.getByRole("button", { name: "Previous source" }));
    fireEvent.click(screen.getByRole("button", { name: "Next source" }));
    expect(onStep.mock.calls).toEqual([[-1], [1]]);
    fireEvent.click(screen.getByRole("button", { name: "Close the source panel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("the first and the last source cannot go further; one source of one", async () => {
    net.routes["rag.passage"] = () => passage;
    const { rerender } = panel({ testId: "", onStep: vi.fn() });
    expect(await screen.findByText("1 of 1 source")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous source" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next source" })).toBeDisabled();
    rerender(
      <SourcePanel
        source={{ docId: "D1", anchor: "§5.2", quote: "" }}
        label="L"
        index={0}
        total={2}
        testId=""
        onClose={vi.fn()}
        onOpenDoc={vi.fn()}
        onPick={vi.fn()}
        onStep={vi.fn()}
      />,
    );
    expect(await screen.findByRole("button", { name: "Next source" })).toBeEnabled();
  });

  it("an unreadable passage shows the quote; no count without sources", async () => {
    panel({ source: { docId: "D", anchor: "§1", quote: "" }, total: 0, testId: "" });
    expect(await screen.findByText("This passage could not be shown.")).toBeInTheDocument();
    expect(screen.queryByText(/«/)).toBeNull();
    expect(screen.queryByText(/of 0/)).toBeNull();
    cleanup();
    panel({ source: { docId: "D", anchor: "§1", quote: "la citation" }, testId: "" });
    expect(await screen.findByText("« la citation »")).toBeInTheDocument();
  });

  it("a source whose document was deleted says so, with its quote, and hides Open in document", async () => {
    net.routes["rag.passage"] = () => refused("GONE is not a document of this project", "doc-gone");
    panel({ source: { docId: "GONE", anchor: "§1", quote: "le texte cité" }, testId: "" });
    expect(await screen.findByText("Document deleted")).toBeInTheDocument();
    expect(screen.getByText(/add GONE again/)).toBeInTheDocument();
    expect(screen.getByText("« le texte cité »")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open in document" })).toBeNull();
  });

  it("shows the passage of the source open now, never one that arrives late", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    net.routes["rag.passage"] = (i) => ({ ...passage, doc: { ...passage.doc, title: String(i.ref) } });
    net.gate = (name, input) => (name === "rag.passage" && String(input.ref).startsWith("A#") ? gate : undefined);
    const props = { label: "L", index: 0, total: 0, testId: "", onClose: vi.fn(), onOpenDoc: vi.fn(), onPick: vi.fn() };
    const { rerender } = mountReview(<SourcePanel {...props} source={{ docId: "A", anchor: "1", quote: "" }} />);
    rerender(<SourcePanel {...props} source={{ docId: "B", anchor: "2", quote: "" }} />);
    expect(await screen.findByRole("heading", { name: "B#2" })).toBeInTheDocument();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole("heading", { name: "B#2" })).toBeInTheDocument();
  });

  it("highlights the quote only when it is at its anchor", async () => {
    net.routes["rag.passage"] = () => passage;
    net.routes["review.evidence"] = () => evidence;
    const { container, unmount } = panel();
    await screen.findByText("ouvert par l'opérateur");
    expect(container.querySelector("mark")).not.toBeNull();
    unmount();
    const finding: Finding = {
      step: 1,
      kind: "quote-not-at-anchor",
      severity: "error",
      message:
        'Step 1: the quote "ouvert par l\'opérateur" is in D1 but not under §5.2: it is under §5.3 — cite D1#§5.3.',
      sources: ["D1#§5.2", "D1#§5.3"],
    };
    const r = panel({ misplaced: finding });
    await screen.findByText(/Le sectionneur est ouvert/);
    expect(r.container.querySelector("mark")).toBeNull();
    expect(screen.getByText("The quote is not at this anchor")).toBeInTheDocument();
    expect(screen.getByText(/it is under §5.3/)).toBeInTheDocument();
  });

  it("finds the quote-not-at-anchor finding of the selected source and step", () => {
    const f: Finding = { step: 2, kind: "quote-not-at-anchor", severity: "error", message: "m", sources: ["D1#§5.2"] };
    const other: Finding = { step: 2, kind: "quote-weak", severity: "warning", message: "w", sources: ["D1#§5.2"] };
    expect(notAtAnchor([other, f], "D1#§5.2", 2)).toBe(f);
    expect(notAtAnchor([f], "D1#§5.2", 1)).toBeUndefined();
    expect(notAtAnchor([f], "D1#§5.3", 2)).toBeUndefined();
    expect(notAtAnchor([f], "D1#§5.2", null)).toBe(f);
  });

  it("asks rag.passage around the quote (a long section), then highlights it", async () => {
    net.routes["rag.passage"] = () => ({ ...passage, truncated: true, quoteFound: true });
    net.routes["review.evidence"] = () => evidence;
    const { container } = panel();
    await screen.findByText("ouvert par l'opérateur");
    expect(named("rag.passage")[0].input).toEqual({ ref: "D1#§5.2", around: "ouvert par l'opérateur" });
    expect(container.querySelector("mark")).not.toBeNull();
  });

  it("says so, without a highlight, when the section does not hold the quote", async () => {
    net.routes["rag.passage"] = () => ({ ...passage, quoteFound: false });
    net.routes["review.evidence"] = () => evidence;
    const { container } = panel({ source: { docId: "D1", anchor: "§5.2", quote: "une phrase ailleurs" } });
    expect(await screen.findByText(/Not highlighted: the quote is not in this section’s own text/)).toBeInTheDocument();
    expect(container.querySelector("mark")).toBeNull();
  });
});

describe("Review › sources read", () => {
  it("lists what the generation read and picks one", async () => {
    net.routes["rag.passage"] = () => passage;
    net.routes["review.evidence"] = () => evidence;
    const onPick = vi.fn();
    panel({ onPick });
    expect(await screen.findByText("2 read")).toBeInTheDocument();
    const head = sourcesRead();
    expect(head).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(head);
    const block = screen.getByRole("region", { name: "Sources read" });
    expect(within(block).getByText("Read by the generation")).toBeInTheDocument();
    expect(within(block).getByText("Cited")).toBeInTheDocument();
    expect(within(block).getByRole("option", { name: /D1#§5\.2/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(block).getByRole("option", { name: /D1#§5\.3/ }));
    expect(onPick).toHaveBeenCalledWith("D1#§5.3");
    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a clean empty state when nothing was recorded (or the command is not there)", async () => {
    net.routes["rag.passage"] = () => passage;
    panel();
    expect(await screen.findByText("Not recorded")).toBeInTheDocument();
    fireEvent.click(sourcesRead());
    expect(screen.getByText(/not recorded for this test/)).toBeInTheDocument();
  });

  it("says « not recorded » for a test without a ledger", async () => {
    net.routes["rag.passage"] = () => passage;
    net.routes["review.evidence"] = () => ({ ...evidence, jobId: null, consulted: [], read: [], searched: [] });
    panel();
    expect(await screen.findByText("Not recorded")).toBeInTheDocument();
    fireEvent.click(sourcesRead());
    expect(await screen.findByText(/Not recorded: this test was not written/)).toBeInTheDocument();
  });

  it("nothing opened, and a skeleton while it loads", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    net.routes["review.evidence"] = () => ({ ...evidence, read: [] });
    net.gate = (name) => (name === "review.evidence" ? gate : undefined);
    mountReview(<EvidenceBlock testId="T" selected="" onPick={vi.fn()} />);
    fireEvent.click(sourcesRead());
    const block = screen.getByRole("region", { name: "Sources read" });
    expect(within(block).queryByText(/Read by the generation/)).toBeNull();
    release();
    expect(await within(block).findByText("Nothing opened.")).toBeInTheDocument();
    expect(screen.getByText("0 read")).toBeInTheDocument();
  });

  it("asks nothing without a test", async () => {
    mountReview(<EvidenceBlock testId="" selected="" onPick={vi.fn()} />);
    await waitFor(() => expect(sourcesRead()).toBeInTheDocument());
    expect(named("review.evidence")).toHaveLength(0);
  });
});
