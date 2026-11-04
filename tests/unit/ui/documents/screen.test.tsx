// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef, JobEvent } from "../../../../src/core/types.ts";
import { docLink } from "../../../../src/ui/components/sources/PassageView.tsx";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { reindexAll } from "../../../../src/ui/lib/uploads.ts";
import { DocumentsScreen } from "../../../../src/ui/screens/documents/DocumentsScreen.tsx";
import { api, FakeEventSource, fakeDesktop, fakeFetch, named, noDesktop } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { at, boxes, doc, emit, mountDocs, refuse } from "./helpers.tsx";

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

const status =
  (over: Record<string, unknown> = {}) =>
  () => ({ exists: true, degraded: null, ...over });
const detail = () => {
  api.routes["docs.show"] = (i) =>
    i.anchor ? { md: "x" } : { doc: doc(String(i.id)), context: "", toc: [], figures: [], md: "" };
};
const listOf = () => screen.getByRole("region", { name: "Document list" });
const rows = () => within(listOf()).getAllByRole("option");
const row = (text: string) => within(listOf()).getAllByText(text)[0].closest('[role="option"]') as HTMLElement;
const zone = (c: HTMLElement) => c.querySelector('[data-testid="documents-screen"]') as HTMLElement;
const veil = (c: HTMLElement) => c.querySelector('[data-testid="drop-veil"]');
const pathDialog = () => screen.getByRole("dialog", { name: "Add a document from a path" });
const addFromPath = () => fireEvent.click(screen.getByRole("button", { name: "Add from a path…" }));

describe("Documents screen", () => {
  it("lists documents with fallbacks, selects from the route and navigates", async () => {
    api.routes["docs.list"] = () => [
      doc("D1", {
        status: "weird" as DocRef["status"],
        indexed: "gone" as DocRef["indexed"],
      }),
      doc("D2", { converted: { with: "", at, warnings: ["w1", "w2"] } }),
    ];
    api.routes["rag.status"] = status({ degraded: "No vectors yet" });
    detail();
    const { app: a } = mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D2#§5" } });
    await waitFor(() => expect(within(listOf()).getByText("weird")).toBeInTheDocument());
    expect(within(listOf()).queryByRole("columnheader", { name: "Binding" })).toBeNull();
    expect(within(listOf()).getByText("Not indexed")).toBeInTheDocument();
    expect(within(row("Title D2")).getByText("2")).toBeInTheDocument();
    expect(screen.getByText("No vectors yet")).toBeInTheDocument();
    expect(screen.getByText(/^2 documents/)).toBeInTheDocument();
    expect(rows()[1]).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(named("docs.show").find((c) => c.input.anchor)?.input).toEqual({ id: "D2", anchor: "§5" }),
    );
    fireEvent.click(rows()[0]);
    expect(a.navigate).toHaveBeenCalledWith("documents", "D1");
    fireEvent.keyDown(rows()[0], { key: "Enter" });
    fireEvent.keyDown(rows()[0], { key: "x" });
    expect(a.navigate).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Choose a search pack" }));
    expect(a.navigate).toHaveBeenCalledWith("settings", "models");
  });

  it("lists the documents with their index state", async () => {
    api.routes["docs.list"] = () => [
      doc("SOSIE_211_D401-1_3", { title: "Traction" }),
      doc("SOSIE_211_D401-1_4", {
        title: "Signalisation",
        indexed: "stale",
        converted: { with: "", at, warnings: ["2 Word comments were dropped"] },
      }),
    ];
    detail();
    mountDocs(<DocumentsScreen />, { route: { screen: "documents" } });
    await waitFor(() => expect(within(listOf()).getByText("Indexed")).toBeInTheDocument());
    expect(within(listOf()).getByText("Reindex needed")).toBeInTheDocument();
    expect(within(listOf()).getByText("Indexed").closest("span")?.querySelector("svg")).not.toBeNull();
  });

  it("goes to an anchor through the detail and shows the first document on other routes", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    api.routes["rag.status"] = status();
    api.routes["docs.show"] = (i) =>
      i.anchor
        ? { md: "x" }
        : { doc: doc("D1"), context: "", toc: [{ anchor: "§1", title: "One", level: 1 }], figures: [], md: "" };
    const { app: a } = mountDocs(<DocumentsScreen />, { route: { screen: "tests" } });
    fireEvent.click(await screen.findByRole("option", { name: "1 One" }));
    expect(a.navigate).toHaveBeenCalledWith("documents", "D1#§1");
    expect(screen.getByText(/^1 document$/)).toBeInTheDocument();
    expect(screen.queryByText("Search on words only")).toBeNull();
  });

  it("a link to a quoted line opens its section, marks the line and scrolls to it at once", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    api.routes["rag.status"] = status();
    api.routes["docs.show"] = (i) =>
      i.anchor
        ? { md: "Première ligne.\n\nLa **deuxième** ligne,\ncitée.\n\nTroisième." }
        : { doc: doc("D1"), context: "", toc: [{ anchor: "§1", title: "One", level: 1 }], figures: [], md: "" };
    const { tops } = boxes({
      '[data-testid="doc-part"]': { top: 100, bottom: 300, height: 200 },
      "[data-focus]": { top: 500, bottom: 520, height: 20 },
      '[data-testid="doc-toc"]': { top: 0, bottom: 100, height: 100 },
      '[aria-selected="true"]': { top: 150, bottom: 170, height: 20 },
    });
    const watch = { cb: () => {}, observe: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          watch.cb = cb;
        }
        observe = watch.observe;
        disconnect = watch.disconnect;
      },
    );
    mountDocs(<DocumentsScreen />, {
      route: { screen: "documents", arg: docLink("D1", "§1", " la deuxième ligne, citée ") },
    });
    expect(await screen.findByText("Troisième.")).toBeInTheDocument();
    expect(named("docs.show").find((c) => c.input.anchor)?.input).toEqual({ id: "D1", anchor: "§1" });
    expect(document.querySelectorAll("[data-focus]")).toHaveLength(1);
    expect(document.querySelector("[data-focus]")).toHaveTextContent("La deuxième ligne, citée.");
    const part = document.querySelector('[data-testid="doc-part"]') as HTMLElement;
    expect(tops.get(part)).toBe(310);
    expect(tops.get(document.querySelector('[data-testid="doc-toc"]') as HTMLElement)).toBe(70);
    expect(watch.observe).toHaveBeenCalledWith(document.querySelector('[data-testid="docs-body"]'));
    expect(watch.observe).toHaveBeenCalledWith(document.querySelector('[data-testid="doc-text"]'));
    watch.cb();
    expect(tops.get(part)).toBe(620);
    fireEvent.wheel(window);
    expect(watch.disconnect).toHaveBeenCalled();
  });

  it("a link to a figure marks the section that holds it in the contents", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    api.routes["rag.status"] = status();
    api.routes["docs.show"] = (i) =>
      i.anchor
        ? { md: "La figure du sectionneur.", section: "§2" }
        : {
            doc: doc("D1"),
            context: "",
            toc: [
              { anchor: "§1", title: "One", level: 1 },
              { anchor: "§2", title: "Two", level: 1 },
            ],
            figures: [],
            md: "",
          };
    const { tops } = boxes({
      '[data-testid="doc-toc"]': { top: 100, bottom: 200, height: 100 },
      '[aria-selected="true"]': { top: 60, bottom: 80 },
    });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D1#fig:fig-1" } });
    expect(await screen.findByText("La figure du sectionneur.")).toBeInTheDocument();
    expect(tops.get(document.querySelector('[data-testid="doc-toc"]') as HTMLElement)).toBe(-40);
    expect(screen.getByRole("option", { name: "2 Two" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "1 One" })).toHaveAttribute("aria-selected", "false");
  });

  it("a link without a quote names only the anchor", () => {
    expect(docLink("D1", "§1")).toBe("D1#§1");
    expect(docLink("D1", "§1", "  ")).toBe("D1#§1");
  });

  it("a deleted document leaves the route and the list is read again", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    api.routes["rag.status"] = status();
    api.routes["docs.remove"] = () => ({ removed: "D1", folder: "", unlinked: [], citedBy: [] });
    detail();
    const { app: a } = mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    fireEvent.click(await screen.findByRole("button", { name: "More actions for this document" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete this document…" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).not.toHaveAttribute("aria-busy"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("documents"));
    await waitFor(() => expect(named("docs.list")).toHaveLength(2));
    expect(a.refreshInfo).toHaveBeenCalled();
  });

  it("an unlisted document id shows no detail; lists that fail or are not arrays are empty", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "NOPE" } });
    await screen.findByText("Title D1");
    expect(screen.queryByRole("region", { name: / details$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show the document list" })).toBeNull();
    cleanup();
    api.routes["docs.list"] = () => ({ not: "a list" });
    mountDocs(<DocumentsScreen />);
    expect(await screen.findByText("No document yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /import a CSV/ })).toBeNull();
    cleanup();
    delete api.routes["docs.list"];
    mountDocs(<DocumentsScreen />);
    expect(await screen.findByText("Could not list the documents")).toBeInTheDocument();
  });

  it("reloads when the index job ends, not for others", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    mountDocs(<DocumentsScreen />);
    await screen.findByText("Title D1");
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    const before = named("docs.list").length;
    const ended = (kind: string, s: string): JobEvent => ({
      jobId: "j",
      at,
      type: "status",
      job: { id: "j", kind, subject: "", status: s as "done", startedAt: at },
    });
    emit(ended("rag-index", "running"));
    emit(ended("check", "done"));
    emit({ jobId: "j", at, type: "progress", message: "x" });
    expect(named("docs.list")).toHaveLength(before);
    emit(ended("rag-index", "done"));
    await waitFor(() => expect(named("docs.list")).toHaveLength(before + 1));
  });

  it("reloads when a job changed a document's files, whatever the job", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    mountDocs(<DocumentsScreen />);
    await screen.findByText("Title D1");
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    const before = named("docs.list").length;
    emit({ jobId: "j", at, type: "changed", paths: ["tests/local-1/test.md"] });
    expect(named("docs.list")).toHaveLength(before);
    emit({ jobId: "j", at, type: "changed", paths: ["docs/D1/doc.json"] });
    await waitFor(() => expect(named("docs.list")).toHaveLength(before + 1));
  });

  it("drag and drop: shows the veil only for files, adds the dropped files", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    const { container } = mountDocs(<DocumentsScreen />);
    await screen.findByText("Title D1");
    const z = zone(container);
    fireEvent.dragOver(z, { dataTransfer: { types: ["text/plain"] } });
    expect(veil(container)).toBeNull();
    fireEvent.dragOver(z, { dataTransfer: { types: ["Files"] } });
    expect(veil(container)).not.toBeNull();
    fireEvent.dragLeave(listOf());
    expect(veil(container)).not.toBeNull();
    fireEvent.dragLeave(z);
    expect(veil(container)).toBeNull();
    api.routes["docs.addFiles"] = () => ({
      added: [],
      rejected: [{ name: "notes.txt", why: "not a document", code: "not-a-document" }],
    });
    refuse("docs.addFiles", (i) => !(i.files as { name: string }[])[0].name.endsWith(".txt"), { error: "not read" });
    fireEvent.drop(z, { dataTransfer: { files: [] } });
    fireEvent.drop(z, { dataTransfer: { files: [new File(["x"], "notes.txt")] } });
    expect(await screen.findByText("Only Word (.docx) and PDF files can be added")).toBeInTheDocument();
    fireEvent.drop(z, { dataTransfer: { files: [new File(["x"], "spec.docx")] } });
    expect(await screen.findByText(/Adding spec.docx stopped/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss spec.docx" }));
    expect(screen.queryByText(/Adding spec.docx stopped/)).toBeNull();
  });

  it("a file still being added in another project is not listed in this one, and that project is not told", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    const f = globalThis.fetch;
    let answer: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) =>
        String(url).includes("/docs/addFiles") ? new Promise<Response>((r) => (answer = r)) : f(url, init),
      ),
    );
    setProject("C:\\A");
    const first = mountDocs(<DocumentsScreen />);
    await screen.findByText("Title D1");
    addFromPath();
    fireEvent.change(screen.getByLabelText("Path of the file"), { target: { value: "C:\\d\\spec.docx" } });
    fireEvent.click(within(pathDialog()).getByRole("button", { name: "Add" }));
    expect((await within(listOf()).findAllByText("spec.docx")).length).toBeGreaterThan(0);
    expect(screen.getByText(/1 in progress/)).toBeInTheDocument();
    first.unmount();
    setProject("C:\\B");
    const { app: b } = mountDocs(<DocumentsScreen />);
    await screen.findByText("Title D1");
    expect(within(listOf()).queryAllByText("spec.docx")).toHaveLength(0);
    expect(screen.queryByText(/in progress/)).toBeNull();
    await act(async () => answer(new Response(JSON.stringify({ added: [{ id: "SPEC" }], rejected: [] }))));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(b.navigate).not.toHaveBeenCalledWith("documents", "SPEC");
  });

  it("Add documents opens the file picker of the browser", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    const { container } = mountDocs(<DocumentsScreen />);
    await screen.findByText("Title D1");
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Add documents" }));
    expect(click).toHaveBeenCalled();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toHaveAttribute("accept", ".docx,.pdf");
    expect(input).toHaveAttribute("multiple");
    fireEvent.change(input, { target: { files: [new File(["x"], "a.txt")] } });
    expect((await within(listOf()).findAllByText("a.txt")).length).toBeGreaterThan(0);
    await waitFor(() => expect(named("docs.addFiles")).toHaveLength(1));
    expect(await screen.findByText(/Adding a.txt stopped/)).toBeInTheDocument();
  });

  it("adds from a path: cancel, Escape, then a quoted path", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    mountDocs(<DocumentsScreen />);
    await screen.findByText("Title D1");
    addFromPath();
    fireEvent.click(within(pathDialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    addFromPath();
    await waitFor(() => expect(screen.getByLabelText("Path of the file")).toHaveFocus());
    fireEvent.keyDown(screen.getByLabelText("Path of the file"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    addFromPath();
    const add = within(pathDialog()).getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Path of the file"), { target: { value: ' "C:\\d\\spec.docx" ' } });
    fireEvent.click(add);
    await waitFor(() => expect(named("docs.addFiles")[0]?.input).toEqual({ files: [{ path: "C:\\d\\spec.docx" }] }));
    expect(await screen.findByText(/Adding spec.docx stopped/)).toBeInTheDocument();
    const r = row("spec.docx");
    expect(within(r).getByText("Not added")).toBeInTheDocument();
    expect(within(r).queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss spec.docx" }));
    expect(within(listOf()).queryAllByText("spec.docx")).toHaveLength(0);
  });

  it("adding a document only copies it, then opens it: no conversion, no index", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    api.routes["docs.addFiles"] = () => ({ jobId: "add-1" });
    api.routes["jobs.show"] = (i) => ({ job: { id: i.id, kind: "x", subject: "", status: "running", startedAt: at } });
    const { app: a } = mountDocs(<DocumentsScreen />);
    await screen.findByText("Title D1");
    addFromPath();
    fireEvent.change(screen.getByLabelText("Path of the file"), { target: { value: "C:/n/new.pdf" } });
    fireEvent.click(within(pathDialog()).getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("progressbar", { name: "Adding" })).toBeInTheDocument();
    expect(screen.getByText(/1 in progress/)).toBeInTheDocument();
    const r = row("new.pdf");
    expect(within(r).queryByRole("progressbar", { name: "Indexing" })).toBeNull();
    expect(within(r).getByText("New document")).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    emit({
      jobId: "add-1",
      at,
      type: "status",
      job: {
        id: "add-1",
        kind: "docs.add",
        subject: "",
        status: "done",
        startedAt: at,
        result: { added: [{ id: "NEW" }], rejected: [] },
      },
    });
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("documents", "NEW"));
    expect(within(listOf()).queryAllByText("new.pdf")).toHaveLength(0);
    expect(named("rag.index")).toEqual([]);
    expect(named("docs.convert")).toEqual([]);
  });

  it("an added document waits, not converted and not indexed, until the team converts it", async () => {
    const d = doc("SOSIE_211_D401-1_5", {
      title: "Itinéraires",
      status: "draft",
      converted: { with: "", at: "", warnings: [] },
      indexed: "missing",
    });
    let added = false;
    api.routes["docs.list"] = () => (added ? [d] : []);
    api.routes["docs.show"] = () => ({ doc: d, context: "", toc: [], figures: [], md: "" });
    api.routes["docs.addFiles"] = () => {
      added = true;
      return { added: [{ id: d.id }], rejected: [] };
    };
    const { app: a, unmount } = mountDocs(<DocumentsScreen />, { route: { screen: "documents" } });
    await screen.findByText("No document yet");
    addFromPath();
    fireEvent.change(screen.getByLabelText("Path of the file"), {
      target: { value: "C:/docs/SOSIE_211_D401-1_5.docx" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(within(listOf()).getByText("Not converted")).toBeVisible());
    expect(a.navigate).toHaveBeenCalledWith("documents", d.id);
    expect(within(listOf()).queryByText(/stopped/)).not.toBeInTheDocument();
    expect(within(listOf()).queryByText("New document")).not.toBeInTheDocument();
    expect(within(listOf()).getAllByText("Itinéraires")).toHaveLength(1);
    expect(named("rag.index")).toHaveLength(0);
    unmount();

    mountDocs(<DocumentsScreen />, { route: { screen: "documents" } });
    await waitFor(() => expect(within(listOf()).getByText("Itinéraires")).toBeInTheDocument());
    expect(within(listOf()).getByText("Not converted")).toBeInTheDocument();
  });

  it("a document listed while its add still runs shows once, as the upload, then as itself", async () => {
    let listed = false;
    const old = doc("OLD", { title: "Older copy", source: { name: "C:/x/other.docx", sha256: "", file: "" } });
    const early = doc("EARLY", {
      title: "early",
      status: "draft",
      indexed: "missing",
      source: { name: "C:\\n\\early.docx", sha256: "", file: "source.docx" },
      converted: undefined,
    });
    api.routes["docs.list"] = () => (listed ? [old, early] : [old]);
    detail();
    api.routes["docs.addFiles"] = () => ({ jobId: "add-3" });
    api.routes["jobs.show"] = (i) => ({ job: { id: i.id, kind: "x", subject: "", status: "running", startedAt: at } });
    const { app: a } = mountDocs(<DocumentsScreen />);
    await screen.findByText("Older copy");
    addFromPath();
    fireEvent.change(screen.getByLabelText("Path of the file"), { target: { value: "C:\\n\\early.docx" } });
    fireEvent.click(within(pathDialog()).getByRole("button", { name: "Add" }));
    await within(listOf()).findAllByText("early.docx");
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    listed = true;
    const ended = (id: string, kind: string, result?: unknown): JobEvent => ({
      jobId: id,
      at,
      type: "status",
      job: { id, kind, subject: "", status: "done", startedAt: at, result },
    });
    const lists = named("docs.list").length;
    emit({ jobId: "", at, type: "changed", paths: ["docs/EARLY/doc.json"] });
    await waitFor(() => expect(named("docs.list").length).toBeGreaterThan(lists));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(within(listOf()).queryByText("Not converted")).toBeNull();
    fireEvent.click(row("early.docx"));
    expect(a.navigate).toHaveBeenCalledWith("documents", "EARLY");
    emit(ended("add-3", "docs.add", { added: [{ id: "EARLY" }], rejected: [] }));
    expect(await within(listOf()).findByText("Not converted")).toBeInTheDocument();
    expect(within(listOf()).queryAllByText("early.docx")).toHaveLength(0);
    expect(rows()).toHaveLength(2);
  });

  it("an index failure with a fix says what to do", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    refuse("rag.index", () => true, { error: "No model", fix: "Install a pack" });
    mountDocs(<DocumentsScreen />);
    await screen.findByText("Title D1");
    await act(() => reindexAll(() => {}));
    expect(await screen.findByText("Install a pack")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the indexing failure of All documents" }));
    expect(screen.queryByText("Install a pack")).toBeNull();
  });
});

describe("Documents screen on the desktop", () => {
  const docRef = doc("SOSIE_3", {
    code: "SOSIE_3",
    title: "Spécification",
    version: "01",
    source: { name: "C:\\specs\\SOSIE_3.docx", sha256: "x", file: "source.docx" },
    converted: { with: "t", at: "", warnings: [] },
  });

  const renderDocs = () => {
    api.routes["docs.list"] = () => [docRef];
    api.routes["docs.addFiles"] = () => ({ added: [{ id: "SOSIE_3" }], rejected: [] });
    api.routes["docs.show"] = (i) =>
      i.anchor ? { md: "text" } : { doc: docRef, context: "", toc: [], figures: [], md: "" };
    return mountDocs(<DocumentsScreen />);
  };

  it("Add documents opens the native picker and adds by path; ⋯ › Show in Explorer reveals docs/<id>", async () => {
    const d = fakeDesktop({ files: ["C:\\specs\\SOSIE_3.docx"] });
    setProject("C:\\p");
    const { container } = renderDocs();
    const click = vi.spyOn(HTMLInputElement.prototype, "click");
    fireEvent.click(await screen.findByRole("button", { name: "Add documents" }));
    await waitFor(() => expect(named("docs.addFiles")).toHaveLength(1));
    expect(click).not.toHaveBeenCalled();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(d.pickFiles).toHaveBeenCalledWith({
      title: "Add documents",
      filters: [{ name: "Word or PDF", extensions: ["docx", "pdf"] }],
      multiple: true,
    });
    expect(named("docs.addFiles")[0].input).toEqual({ files: [{ path: "C:\\specs\\SOSIE_3.docx" }] });
    fireEvent.click(await screen.findByRole("button", { name: "More actions for this document" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show in Explorer" }));
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith("C:\\p\\docs\\SOSIE_3"));
  });

  it("without the bridge: the hidden file input, no Show in Explorer", async () => {
    renderDocs();
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(await screen.findByRole("button", { name: "Add documents" }));
    expect(click).toHaveBeenCalled();
    await screen.findByRole("heading", { name: "Spécification" });
    fireEvent.click(screen.getByRole("button", { name: "More actions for this document" }));
    expect(screen.queryByRole("menuitem", { name: "Show in Explorer" })).toBeNull();
  });

  it("a dropped file in the desktop window is added by its path", async () => {
    fakeDesktop({ paths: { "SOSIE_3.docx": "C:\\specs\\SOSIE_3.docx" } });
    const view = renderDocs();
    await screen.findByRole("heading", { name: "Spécification" });
    fireEvent.drop(zone(view.container), {
      dataTransfer: { files: [new File(["PK-word"], "SOSIE_3.docx")], types: ["Files"] },
    });
    await waitFor(() => expect(named("docs.addFiles")).toHaveLength(1));
    expect(named("docs.addFiles")[0].input).toEqual({ files: [{ path: "C:\\specs\\SOSIE_3.docx" }] });
  });
});
