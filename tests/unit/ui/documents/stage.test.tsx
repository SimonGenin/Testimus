// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocStage as Stage } from "../../../../src/core/types.ts";
import { DocStage } from "../../../../src/ui/components/sources/DocStage.tsx";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { stageWith } from "../../../../src/ui/lib/stage.ts";
import { DocumentsScreen } from "../../../../src/ui/screens/documents/DocumentsScreen.tsx";
import { api, FakeEventSource, fakeFetch, named, noDesktop } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { at, doc, mountDocs } from "./helpers.tsx";

beforeEach(() => {
  fakeFetch();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  clearToasts();
  noDesktop();
  setProject(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const iconOf = (el: HTMLElement) => el.closest("span")?.querySelector("svg")?.getAttribute("data-icon") ?? null;

describe("DocStage", () => {
  const cases: [Stage, string][] = [
    [{ name: "pending", bytes: 2_500_000 }, "Waiting to start"],
    [{ name: "copying", step: "waiting", done: 0, total: 9 }, "Waiting to copy"],
    [{ name: "copying", done: 4, total: 10, percent: 40 }, "Copying · 40 %"],
    [{ name: "not-converted" }, "Not converted"],
    [{ name: "converting", step: "waiting" }, "Waiting to convert"],
    [{ name: "converting", step: "text", percent: 25 }, "Converting the text · 25 %"],
    [{ name: "converting", step: "figures" }, "Describing the figures"],
    [{ name: "converting", step: "pictures" }, "Reading the pictures"],
    [{ name: "converting", step: "transcribing" }, "Transcribing"],
    [{ name: "converting", step: "frames" }, "Looking at the frames"],
    [{ name: "converting", step: "checking" }, "Checking the citing tests"],
    [{ name: "converting" }, "Converting"],
    [{ name: "waiting-index", before: 3 }, "Waiting to index · 3 documents before"],
    [{ name: "waiting-index" }, "Waiting to index"],
    [{ name: "indexing", percent: 42 }, "Indexing · 42 %"],
    [{ name: "not-indexed" }, "Not indexed"],
    [{ name: "ready" }, "Indexed"],
    [{ name: "stale" }, "Not up to date"],
    [{ name: "failed", step: "copy", message: "gone" }, "Copy failed"],
    [{ name: "failed", step: "convert", message: "damaged" }, "Conversion failed"],
    [{ name: "failed", step: "index", message: "no room" }, "Indexing failed"],
  ];

  it("says each stage in its words, an icon or a spinner beside", () => {
    for (const [stage, words] of cases) {
      const { unmount } = render(<DocStage stage={stage} />);
      const el = screen.getByText(words);
      expect(el).toBeInTheDocument();
      const moving = ["copying", "converting", "indexing"].includes(stage.name) && stage.step !== "waiting";
      if (!moving) expect(iconOf(el), words).not.toBeNull();
      unmount();
    }
  });

  it("the page's own job stands for the stage until docs.list says it moves", () => {
    const d = doc("A", { converted: undefined, indexed: "missing" });
    expect(stageWith(d)).toEqual({ name: "not-converted" });
    expect(stageWith(d, { phase: "waiting", pct: null })).toEqual({ name: "converting", step: "waiting" });
    expect(stageWith(d, { phase: "converting", pct: 30 })).toEqual({ name: "converting", percent: 30 });
    expect(stageWith(d, { phase: "adding", pct: null })).toEqual({ name: "copying" });
    expect(stageWith(d, { phase: "indexing", pct: null, message: "Waiting for the running index" })).toEqual({
      name: "waiting-index",
    });
    const moving = doc("B", { stage: { name: "converting", step: "figures" } });
    expect(stageWith(moving, { phase: "converting", pct: 30 })).toEqual({ name: "converting", step: "figures" });
  });
});

const plan = (over: Record<string, unknown> = {}) => ({
  ids: ["W1", "W2", "V1"],
  byType: { docx: 2, pdf: 0, txt: 0, images: 0, video: 1, mixed: 0 },
  files: 3,
  bytes: 1_500_000_000,
  needBytes: 2_400_000_000,
  freeBytes: 640_000_000_000,
  short: false,
  claudeRuns: 14,
  slots: 5,
  copySeconds: 25,
  convertSeconds: 1500,
  seconds: 1525,
  ...over,
});

const pending = (id: string, title: string, size: number) =>
  doc(id, {
    title,
    converted: undefined,
    indexed: "missing",
    pending: { files: [{ path: `D:\\Specs\\${title}`, size }], at },
  });

const listOf = () => screen.getByRole("region", { name: "Document list" });

function routes(over: Record<string, unknown> = {}) {
  const docs = [
    doc("D1", { title: "Traction" }),
    pending("W1", "SPEC_A.docx", 1_000_000),
    pending("W2", "SPEC_B.docx", 2_000_000),
    pending("V1", "Essai.mp4", 1_497_000_000),
  ];
  api.routes["docs.list"] = () => docs;
  api.routes["rag.status"] = () => ({});
  api.routes["docs.overviewShow"] = () => null;
  api.routes["docs.planStart"] = (i) => plan(i.ids ? { ids: i.ids, bytes: 2_000_000, short: false, ...over } : over);
  api.routes["docs.show"] = (i) => ({
    doc: docs.find((d) => d.id === i.id) ?? doc(String(i.id)),
    context: "",
    toc: [],
    figures: [],
    md: "",
  });
  api.routes["contexts.list"] = () => [];
  api.routes["docs.start"] = () => ({ jobId: "start-1" });
  api.routes["docs.remove"] = (i) => ({
    removed: i.id,
    folder: "",
    unlinked: [],
    citedBy: [],
    passages: 0,
    dryRun: false,
  });
}

describe("The documents waiting to start", () => {
  it("are summed up at the head of the list: by type, the volume, the room, Claude's runs, the time", async () => {
    routes();
    mountDocs(<DocumentsScreen />);
    const batch = await within(listOf()).findByRole("region", { name: /3 documents waiting to start/ });
    expect(await within(batch).findByText("2 Word · 1 video")).toBeInTheDocument();
    expect(within(batch).getByText("1.5 GB · 3 files")).toBeInTheDocument();
    expect(within(batch).getByText("2.4 GB needed · 640.0 GB free on the project's drive")).toBeInTheDocument();
    expect(within(batch).getByText("About 14 runs")).toBeInTheDocument();
    expect(within(batch).getByText("about 25 min · estimated (5 at a time)")).toBeInTheDocument();
    expect(within(listOf()).getAllByText("Waiting to start")).toHaveLength(3);
    expect(within(listOf()).getByText("Indexed")).toBeInTheDocument();
  });

  it("Start all starts them in one job; a choice starts only those ticked", async () => {
    routes();
    mountDocs(<DocumentsScreen />);
    const batch = await within(listOf()).findByRole("region", { name: /3 documents waiting to start/ });
    fireEvent.click(within(batch).getByRole("button", { name: "Start all" }));
    await waitFor(() => expect(named("docs.start")[0]?.input).toEqual({ triage: true, index: true }));
    expect(await screen.findByText("Starting 3 documents")).toBeInTheDocument();
    fireEvent.click(within(batch).getByRole("button", { name: "Choose the documents" }));
    fireEvent.click(within(batch).getByRole("checkbox", { name: "Essai.mp4" }));
    await waitFor(() => expect(named("docs.planStart").some((c) => Array.isArray(c.input.ids))).toBe(true));
    fireEvent.click(within(batch).getByRole("button", { name: "Start 2 documents" }));
    await waitFor(() => expect(named("docs.start")[1]?.input).toMatchObject({ ids: ["W1", "W2"] }));
  });

  it("Remove takes the ticked ones away, one call each", async () => {
    routes();
    mountDocs(<DocumentsScreen />);
    const batch = await within(listOf()).findByRole("region", { name: /3 documents waiting to start/ });
    fireEvent.click(within(batch).getByRole("button", { name: "Choose the documents" }));
    fireEvent.click(within(batch).getByRole("checkbox", { name: "SPEC_A.docx" }));
    fireEvent.click(within(batch).getByRole("button", { name: "Remove 2 documents" }));
    await waitFor(() => expect(named("docs.remove").map((c) => c.input.id)).toEqual(["W2", "V1"]));
  });

  it("a drive without room says so and Start waits", async () => {
    routes({ short: true });
    mountDocs(<DocumentsScreen />);
    const batch = await within(listOf()).findByRole("region", { name: /3 documents waiting to start/ });
    expect(
      await within(batch).findByText(/Not enough room on the project's drive for these copies/),
    ).toBeInTheDocument();
    expect(within(batch).getByRole("button", { name: "Start all" })).toBeDisabled();
  });

  it("one opened says where its original is, starts or goes", async () => {
    routes();
    const removed = vi.fn();
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "W1" }, navigate: removed });
    const side = await screen.findByRole("region", { name: "C-W1 details" });
    expect(await within(side).findByText(/D:\\Specs\\SPEC_A\.docx · 1 MB/)).toBeInTheDocument();
    fireEvent.click(within(side).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(named("docs.start")[0]?.input).toMatchObject({ ids: ["W1"] }));
    fireEvent.click(within(side).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(named("docs.remove")[0]?.input).toEqual({ id: "W1" }));
    await waitFor(() => expect(removed).toHaveBeenCalledWith("documents"));
  });
});
