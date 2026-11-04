// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { importClaude, setImportClaude } from "../../../../src/ui/lib/uploads.ts";
import { ClaudeChoice } from "../../../../src/ui/screens/documents/ConvertDoc.tsx";
import { DocumentsScreen } from "../../../../src/ui/screens/documents/DocumentsScreen.tsx";
import { api, FakeEventSource, fakeFetch, named, noDesktop } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { at, doc, emit, mountDocs, refuse, startsJob } from "./helpers.tsx";

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

const listOf = () => screen.getByRole("region", { name: "Document list" });
const running = (i: Record<string, unknown>) => ({
  job: { id: i.id, kind: "x", subject: "", status: "running", startedAt: at },
});

describe("Converting a document", () => {
  it("a document not converted yet: its facts, the job's context, convert and index in one job, failures with their fix", async () => {
    let converted = false;
    const fresh = () =>
      doc("NEW2", {
        title: "fresh",
        source: { name: "C:/n/fresh.docx", sha256: "", file: "source.docx" },
        indexed: "missing",
        converted: converted ? { with: "", at, warnings: [] } : undefined,
      });
    api.routes["docs.list"] = () => [fresh()];
    api.routes["docs.show"] = (i) =>
      i.anchor ? { md: "x" } : { doc: fresh(), context: "", toc: [], figures: [], md: "" };
    api.routes["contexts.list"] = () => [];
    let fail = true;
    api.routes["docs.convert"] = startsJob("conv-2", "docs.convert");
    refuse("docs.convert", () => fail, { error: "source missing" });
    api.routes["jobs.show"] = running;
    const { app: a } = mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "NEW2" } });
    expect(await within(listOf()).findByText("Not converted")).toBeInTheDocument();
    const side = await screen.findByRole("region", { name: "C-NEW2 details" });
    expect(within(side).getByText(/Word file, not converted · fresh.docx/)).toBeInTheDocument();
    expect(within(side).getByLabelText("Note for this document")).toBeInTheDocument();
    expect(within(side).getByText("Not converted yet")).toBeInTheDocument();
    expect(within(side).queryByRole("navigation", { name: "Sections" })).toBeNull();
    expect(within(side).queryByText("Context for this conversion only")).toBeNull();

    fireEvent.click(within(side).getByRole("button", { name: "Convert and index" }));
    await waitFor(() =>
      expect(named("docs.convert")[0]?.input).toEqual({
        id: "NEW2",
        contexts: [],
        describeFigures: true,
        triage: true,
        index: true,
      }),
    );
    expect(await within(listOf()).findByText("Conversion failed")).toBeInTheDocument();
    expect(within(listOf()).getByText(/fresh.docx stays as it was: source missing/)).toBeInTheDocument();
    fireEvent.click(within(listOf()).getByRole("button", { name: "Dismiss the conversion failure of fresh.docx" }));
    expect(within(listOf()).queryByText("Conversion failed")).toBeNull();
    expect(named("rag.index")).toEqual([]);

    fail = false;
    fireEvent.click(within(side).getByRole("button", { name: "Convert and index" }));
    expect(await within(listOf()).findByRole("progressbar", { name: "Converting" })).toBeInTheDocument();
    const reading = within(side).getByRole("region", { name: "Reading the document" });
    expect(reading).toHaveAttribute("aria-busy", "true");
    expect(within(side).queryByRole("region", { name: "Convert and index" })).toBeNull();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    converted = true;
    emit({
      jobId: "conv-2",
      at,
      type: "steps",
      steps: [
        { id: "convert", label: "Convert to text", status: "done" },
        { id: "index", label: "Update the search index", status: "running" },
      ],
    });
    emit({ jobId: "conv-2", at, type: "progress", message: "Waiting for the other conversions", step: "index" });
    expect(await within(listOf()).findByRole("progressbar", { name: "Indexing" })).toBeInTheDocument();
    emit({ jobId: "conv-2", at, type: "progress", message: "m", done: 3, total: 4, step: "index" });
    expect(await within(listOf()).findByText(/75%/)).toBeInTheDocument();
    emit({
      jobId: "conv-2",
      at,
      type: "status",
      job: {
        id: "conv-2",
        kind: "docs.convert",
        subject: "NEW2",
        status: "done",
        startedAt: at,
        result: { id: "NEW2", index: { error: "model missing" } },
      },
    });
    expect(await within(listOf()).findByText("Indexing failed")).toBeInTheDocument();
    expect(
      within(listOf()).getByText(/fresh.docx was converted, but search cannot find it yet: model missing/),
    ).toBeInTheDocument();
    fireEvent.click(within(listOf()).getByRole("button", { name: "Open Jobs" }));
    expect(a.navigate).toHaveBeenCalledWith("jobs");
    fireEvent.click(within(listOf()).getByRole("button", { name: "Dismiss the indexing failure of fresh.docx" }));
    expect(within(listOf()).queryByText(/search cannot find it yet/)).toBeNull();
    expect(named("rag.index")).toEqual([]);
  });

  it("while a document converts, the panel shows what is read and locks the rest until it is indexed", async () => {
    let converted = false;
    let described = 0;
    const fresh = () =>
      doc("NEW3", {
        title: "fresh",
        source: { name: "C:/n/fresh.docx", sha256: "", file: "source.docx" },
        indexed: converted ? "fresh" : "missing",
        converted: converted ? { with: "", at, warnings: [] } : undefined,
      });
    const toc = [
      { anchor: "§1", title: "Objet", level: 1 },
      { anchor: "§1.1", title: "Portée", level: 2 },
      { anchor: "§1.1.1", title: "Détail", level: 3 },
      { anchor: "§2", title: "Règles", level: 1 },
    ];
    const figures = ["a", "b", "c"].map((f) => ({
      file: `figures/${f}.png`,
      anchor: `fig:${f}`,
      caption: `Figure ${f}`,
      description: "",
    }));
    let outline = false;
    api.routes["docs.list"] = () => [fresh()];
    api.routes["docs.show"] = (i) =>
      i.anchor
        ? { md: "Le texte" }
        : {
            doc: fresh(),
            context: "",
            toc: outline ? toc : [],
            figures: outline ? figures.map((f, k) => ({ ...f, description: k < described ? "seen" : "" })) : [],
            md: "",
          };
    api.routes["contexts.list"] = () => [];
    api.routes["docs.convert"] = startsJob("conv-5", "docs.convert", "", { message: "Converting source.docx" });
    api.routes["jobs.show"] = (i) => ({
      job: { id: i.id, kind: "x", subject: "", status: "running", startedAt: at, message: "Converting source.docx" },
    });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "NEW3" } });
    let side = await screen.findByRole("region", { name: "C-NEW3 details" });
    fireEvent.click(within(side).getByRole("button", { name: "Convert and index" }));
    const reading = await within(side).findByRole("region", { name: "Reading the document" });
    expect(await within(reading).findByText("Converting source.docx")).toBeInTheDocument();
    expect(within(reading).getByRole("listitem", { current: "step" })).toHaveTextContent("Reading the file");
    expect(reading.querySelector('[data-testid="reading-scan"]')).not.toBeNull();
    for (const b of within(within(side).getByRole("radiogroup", { name: "Status" })).getAllByRole("radio"))
      expect(b).toBeDisabled();
    expect(within(side).getByLabelText("Note for this document")).toBeDisabled();
    expect(within(side).queryByRole("button", { name: "More actions for this document" })).toBeNull();
    expect(within(side).getByText(/Converting from Word · fresh.docx/)).toBeInTheDocument();

    outline = true;
    described = 1;
    emit({ jobId: "conv-5", at, type: "progress", message: "Describing the figures of NEW3", done: 0, total: 3 });
    const secs = await within(reading).findByRole("list", { name: "Sections read" });
    await waitFor(() => expect(within(secs).getAllByRole("listitem")).toHaveLength(3));
    expect(within(secs).getByText("1.1 Portée")).toBeInTheDocument();
    expect(within(reading).getByRole("listitem", { current: "step" })).toHaveTextContent(
      "Claude describes the figures1/3",
    );
    const figs = within(reading).getByRole("list", { name: "Figures" });
    expect(within(figs).getByText("Figure a: described")).toBeInTheDocument();
    expect(within(figs).getByText("Figure b: not described yet")).toBeInTheDocument();
    expect(figs.querySelectorAll("[data-looking]")).toHaveLength(2);
    expect(within(side).queryByRole("button", { name: "Figure a" })).toBeNull();
    expect(within(side).queryByRole("navigation", { name: "Sections" })).toBeNull();

    described = 3;
    converted = true;
    emit({ jobId: "conv-5", at, type: "progress", message: "Describing the figures of NEW3", done: 3, total: 3 });
    await waitFor(() => expect(within(reading).getByText("Figure c: described")).toBeInTheDocument());
    const lists = named("docs.list").length;
    emit({ jobId: "", at, type: "changed", paths: ["docs/NEW3/doc.json"] });
    await waitFor(() => expect(named("docs.list").length).toBeGreaterThan(lists));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    emit({
      jobId: "conv-5",
      at,
      type: "steps",
      steps: [
        { id: "convert", label: "Convert to text", status: "done" },
        { id: "index", label: "Update the search index", status: "running" },
      ],
    });
    emit({ jobId: "conv-5", at, type: "progress", message: "Waiting for the other conversions", step: "index" });
    side = await screen.findByRole("region", { name: "C-NEW3 details" });
    const again = await within(side).findByRole("region", { name: "Reading the document" });
    await waitFor(() => expect(within(again).getByRole("listitem", { current: "step" })).toHaveTextContent("Indexing"));
    emit({ jobId: "conv-5", at, type: "progress", message: "Embedding NEW3", done: 2, total: 3, step: "index" });
    await waitFor(() => expect(again.querySelectorAll('[data-state="indexed"]')).toHaveLength(2));
    expect(again.querySelector('[data-state="now"]')).toHaveTextContent("2 Règles");
    expect(again.querySelectorAll("[data-done]")).toHaveLength(3);

    emit({
      jobId: "conv-5",
      at,
      type: "status",
      job: {
        id: "conv-5",
        kind: "docs.convert",
        subject: "NEW3",
        status: "done",
        startedAt: at,
        result: { id: "NEW3", index: { chunks: 3 } },
      },
    });
    expect(await within(side).findByRole("navigation", { name: "Sections" })).toBeInTheDocument();
    expect(within(side).queryByRole("region", { name: "Reading the document" })).toBeNull();
    expect(side).toHaveAttribute("data-opened", "true");
    for (const b of within(within(side).getByRole("radiogroup", { name: "Status" })).getAllByRole("radio"))
      expect(b).toBeEnabled();
    expect(named("rag.index")).toEqual([]);
  });

  it("a converted document is converted again from its menu, and the dialog closes", async () => {
    const d1 = doc("D1", {
      converted: { with: "", at, warnings: ["w"], stats: { sections: 6, figures: 21, chars: 900 } },
      source: { name: "C:/x/source.docx", sha256: "", file: "source.docx" },
    });
    api.routes["docs.list"] = () => [d1];
    api.routes["docs.show"] = (i) =>
      i.anchor
        ? { md: "x" }
        : {
            doc: d1,
            context: "",
            toc: [],
            figures: [{ file: "f.png", anchor: "fig:1", caption: "", description: "lu" }],
            md: "",
          };
    api.routes["contexts.list"] = () => [];
    api.routes["docs.convert"] = startsJob("conv-4", "docs.convert");
    api.routes["jobs.show"] = running;
    mountDocs(<DocumentsScreen />);
    const side = await screen.findByRole("region", { name: "C-D1 details" });
    const menu = () => fireEvent.click(within(side).getByRole("button", { name: "More actions for this document" }));
    expect(screen.queryByRole("dialog", { name: "Convert C-D1 again?" })).toBeNull();
    menu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Convert again…" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Convert C-D1 again?" })).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("dialog", { name: "Convert C-D1 again?" })).toBeNull();
    menu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Convert again…" }));
    const dialog = screen.getByRole("dialog", { name: "Convert C-D1 again?" });
    expect(dialog).toHaveTextContent("Reads source.docx again and reindexes it.");
    const said = (text: RegExp) => within(dialog).getByText(text).closest("li")?.textContent;
    expect(said(/^figures read again/)).toBe("21figures read again — 1 already described is kept");
    expect(said(/^sections reindexed/)).toBe("6sections reindexed in every vector space");
    expect(said(/^conversion warning/)).toBe("1conversion warning recomputed");
    const counts = within(dialog).getByText(/^figures read again/).closest("ul") as HTMLElement;
    expect(
      counts.compareDocumentPosition(within(dialog).getByText("While converting")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(dialog).toHaveTextContent("It runs in Jobs; you can keep working.");
    const describe = within(dialog).getByRole("checkbox", { name: "Claude describes the figures not described yet" });
    expect(describe).toBeChecked();
    fireEvent.click(describe);
    fireEvent.click(within(dialog).getByRole("button", { name: "Convert again and index" }));
    await waitFor(() =>
      expect(named("docs.convert")[0]?.input).toEqual({
        id: "D1",
        contexts: [],
        describeFigures: false,
        triage: true,
        index: true,
      }),
    );
    expect(screen.queryByRole("dialog", { name: "Convert C-D1 again?" })).toBeNull();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    emit({
      jobId: "conv-4",
      at,
      type: "status",
      job: { id: "conv-4", kind: "docs.convert", subject: "D1", status: "failed", startedAt: at, error: "stopped" },
    });
    await waitFor(() => expect(within(side).queryByRole("progressbar", { name: "Converting" })).toBeNull());
  });
});

describe("Convert again with Claude's study", () => {
  const DOC = doc("SOSIE_441", {
    code: "SOSIE_441",
    title: "TOC",
    version: "01.00",
    status: "draft",
    source: { name: "C:/client/SOSIE_441_01.00.pdf", sha256: "", file: "source.pdf" },
    converted: { with: "pdfjs-dist (tagged PDF)", at: "2026-11-03T00:00:00.000Z", warnings: [] },
    conversion: {
      reader: "tagged",
      numbers: [
        { number: "1", title: "Généralités" },
        { number: "1.1", title: "Objet" },
      ],
      notes: "Numbers drawn by Word.",
    },
  });

  const routes = () => {
    api.routes["docs.list"] = () => [DOC];
    api.routes["docs.show"] = (i) => (i.anchor ? { md: "x" } : { doc: DOC, context: "", toc: [], figures: [], md: "" });
    api.routes["contexts.list"] = () => [];
    api.routes["docs.convert"] = startsJob("conv-9", "docs.convert");
    api.routes["jobs.show"] = running;
  };

  it("shows the options kept from the study and sends study when ticked, without triage, the index in the same job", async () => {
    routes();
    mountDocs(<DocumentsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for this document" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Convert again…" }));
    const dialog = screen.getByRole("dialog", { name: "Convert SOSIE_441 again?" });
    const kept = within(dialog).getByText("Converted from the PDF tags, 2 heading numbers read on the pages.");
    expect(kept).toHaveAttribute("title", "Numbers drawn by Word.");
    const box = within(dialog).getByRole("checkbox", { name: /Claude studies the original first/ });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.click(within(dialog).getByRole("button", { name: "Convert again and index" }));
    await waitFor(() => expect(named("docs.convert")).toHaveLength(1));
    const input = named("docs.convert")[0].input;
    expect(input).toMatchObject({ id: "SOSIE_441", study: true, index: true });
    expect(input).not.toHaveProperty("triage");
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(named("rag.index")).toHaveLength(0);
    expect(named("actions.triage")).toHaveLength(0);
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    emit({
      jobId: "conv-9",
      at,
      type: "status",
      job: {
        id: "conv-9",
        kind: "docs.convert",
        subject: DOC.id,
        status: "done",
        startedAt: at,
        result: { id: DOC.id },
      },
    });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Reading the document" })).toBeNull());
  });

  it("leaves study out by default and asks the core to triage the warnings in the same job", async () => {
    routes();
    api.routes["docs.show"] = () => ({
      doc: { ...DOC, conversion: undefined, converted: undefined },
      context: "",
      toc: [],
      figures: [],
      md: "",
    });
    mountDocs(<DocumentsScreen />);
    const card = await screen.findByRole("region", { name: "Convert and index" });
    expect(within(card).queryByText(/Converted from/)).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Convert and index" }));
    await waitFor(() => expect(named("docs.convert")).toHaveLength(1));
    const input = named("docs.convert")[0].input;
    expect(input).not.toHaveProperty("study");
    expect(input).toMatchObject({ triage: true, index: true });
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(named("actions.triage")).toHaveLength(0);
    expect(named("claude.status")).toHaveLength(0);
  });
});

describe("ClaudeChoice", () => {
  afterEach(() => setImportClaude({}));

  it("shows the project model at low effort, and keeps what is picked for the next conversions", () => {
    mountDocs(<ClaudeChoice />);
    const effort = screen.getByRole("combobox", { name: "Effort" });
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("sonnet");
    expect(effort).toHaveValue("low");
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), { target: { value: "opus" } });
    fireEvent.change(effort, { target: { value: "high" } });
    expect(importClaude()).toEqual({ model: "opus", effort: "high" });
    cleanup();
    mountDocs(<ClaudeChoice />, { info: undefined });
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("opus");
    expect(screen.getByRole("combobox", { name: "Effort" })).toHaveValue("high");
    setImportClaude({});
    cleanup();
    mountDocs(<ClaudeChoice />, { info: undefined });
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("opus");
  });
});
