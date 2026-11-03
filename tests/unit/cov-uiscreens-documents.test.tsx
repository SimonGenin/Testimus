// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef, JobEvent } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { setTraces } from "../../src/ui/lib/traces.ts";
import { DocDetail } from "../../src/ui/screens/documents/DocDetail.tsx";
import { DocText, FigureChip } from "../../src/ui/screens/documents/DocText.tsx";
import { DocumentsScreen } from "../../src/ui/screens/documents/DocumentsScreen.tsx";
import { clearToasts, mount } from "./cov-uiscreens-helpers.tsx";
import { api, FakeEventSource, fakeDesktop, fakeFetch, named, noDesktop } from "./ui-desktop-helpers.tsx";

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

const at = "2026-11-02T10:00:00.000Z";
const emit = (e: JobEvent) => act(() => FakeEventSource.last?.emit(e));

const doc = (id: string, over: Partial<DocRef> = {}): DocRef => ({
  id,
  code: `C-${id}`,
  title: `Title ${id}`,
  version: "01.01",
  date: "",
  kind: "spec",
  status: "validated",
  binding: "mandatory",
  source: { path: "", sha256: "", file: "source.docx" },
  convertedWith: "",
  convertedAt: "",
  warnings: [],
  indexed: "fresh",
  ...over,
});

describe("DocText", () => {
  it("renders headings, figures, tables, inline marks, requirement chips and the focus", () => {
    setProject("C:/p");
    const onRequirement = vi.fn();
    const onFigure = vi.fn();
    const md = [
      "## 5.6 Sectionneur",
      "# Title\nwith a second line",
      "![Vue de traction](figures/fig-1.png) <!-- fig fig-1 -->",
      '![Plain](figures/x.png "t")',
      "| a | b |\n| - | - |",
      "Le **sectionneur** est *ouvert* selon EXI_MOP_1 et EXI_MOP_1 puis EXI_MOP_2.",
      "Selon le type de sectionneur, le menu diffère",
      "<!-- only a comment -->",
    ].join("\n\n");
    const { container } = render(
      <DocText docId="D1" md={md} focus="Selon le  type" onRequirement={onRequirement} onFigure={onFigure} />,
    );
    expect(screen.getByRole("heading", { name: "5.6 Sectionneur" })).toHaveAttribute("data-level", "2");
    expect(screen.getByText(/with a second line/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Vue de traction" })).toHaveAttribute(
      "src",
      "/files/docs/D1/figures/fig-1.png?project=C%3A%2Fp",
    );
    fireEvent.click(screen.getByRole("button", { name: "Vue de traction" }));
    expect(onFigure).toHaveBeenCalledWith("fig:fig-1");
    expect(screen.getByText("Plain", { selector: "figcaption" })).toBeInTheDocument();
    expect(container.querySelector("pre.doctext-table")).toHaveTextContent("| a | b |");
    expect(screen.getByText("sectionneur", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("ouvert", { selector: "em" })).toBeInTheDocument();
    const chips = screen.getAllByRole("button", { name: /EXI_MOP_/ });
    expect(chips).toHaveLength(2);
    fireEvent.click(chips[1]);
    expect(onRequirement).toHaveBeenCalledWith("EXI_MOP_2");
    expect(container.querySelectorAll(".is-focus")).toHaveLength(1);
    expect(container.querySelector(".is-focus")).toHaveTextContent("Selon le type de sectionneur");
  });

  it("says when the part is empty; no focus without one", () => {
    const { rerender, container } = render(
      <DocText docId="D" md={"<!-- x -->\n\n\n"} onRequirement={vi.fn()} onFigure={vi.fn()} />,
    );
    expect(screen.getByText("This part of the document is empty.")).toBeInTheDocument();
    rerender(<DocText docId="D" md="**all bold**" onRequirement={vi.fn()} onFigure={vi.fn()} />);
    expect(container.querySelector(".is-focus")).toBeNull();
    expect(screen.getByText("all bold", { selector: "strong" })).toBeInTheDocument();
  });

  it("FigureChip is a button with its caption", () => {
    const onClick = vi.fn();
    render(<FigureChip caption="Figure 3" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Figure 3" }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("DocDetail", () => {
  const shown = (over: Record<string, unknown> = {}) => ({
    doc: doc("D1", {
      date: "2026-01-02",
      source: { path: "", sha256: "", file: "x.pdf" },
      warnings: ["2 comments dropped"],
      amends: ["D2"],
    }),
    context: "known",
    toc: [
      { anchor: "§5", title: "Traction", level: 1 },
      { anchor: "§5.6", title: "Sectionneur", level: 2 },
    ],
    requirements: ["EXI_1"],
    figures: [
      { file: "f", anchor: "fig:fig-1", caption: "Vue", description: "" },
      { file: "g", anchor: "fig:fig-2", caption: "", description: "" },
    ],
    md: "",
    ...over,
  });
  const docs = [doc("D1"), doc("D2"), doc("D3")];
  const show = (anchor = "", over: Record<string, unknown> = {}) => {
    const onAnchor = vi.fn();
    const onChanged = vi.fn();
    const onReindex = vi.fn();
    api.routes["docs.show"] = (i) => (i.anchor ? { md: `Part ${i.anchor} EXI_1` } : shown(over));
    mount(
      <DocDetail id="D1" anchor={anchor} docs={docs} onAnchor={onAnchor} onChanged={onChanged} onReindex={onReindex} />,
    );
    return { onAnchor, onChanged, onReindex };
  };

  it("shows the document, its facts and the first sub-section by default", async () => {
    const { onAnchor, onReindex } = show();
    expect(await screen.findByRole("heading", { name: "Title D1" })).toBeInTheDocument();
    expect(screen.getByText("2026-01-02")).toBeInTheDocument();
    expect(screen.getByText(/Converted from PDF · 2 sections · 1 requirement id · 2 figures/)).toBeInTheDocument();
    expect(screen.getByText("2 comments dropped")).toBeInTheDocument();
    expect(await screen.findByText("Part §5.6 EXI_1")).toBeInTheDocument();
    const toc = screen.getByRole("navigation", { name: "Sections" });
    expect(within(toc).getByRole("button", { name: "5.6 Sectionneur" })).toHaveAttribute("aria-current", "true");
    fireEvent.click(within(toc).getByRole("button", { name: "5 Traction" }));
    expect(onAnchor).toHaveBeenCalledWith("§5");
    fireEvent.click(document.querySelector(".docreqs button") as HTMLElement);
    expect(onAnchor).toHaveBeenCalledWith("req:EXI_1");
    fireEvent.click(screen.getByRole("button", { name: "Vue" }));
    expect(onAnchor).toHaveBeenCalledWith("fig:fig-1");
    fireEvent.click(screen.getByRole("button", { name: "fig:fig-2" }));
    expect(onAnchor).toHaveBeenCalledWith("fig:fig-2");
    fireEvent.click(screen.getByRole("button", { name: "Reindex" }));
    expect(onReindex).toHaveBeenCalled();
    const inText = screen.getAllByRole("button", { name: "EXI_1" }).find((b) => b.closest(".doctext"));
    fireEvent.click(inText as HTMLElement);
    expect(onAnchor).toHaveBeenLastCalledWith("req:EXI_1");
  });

  it("focuses a requirement anchor and marks its chip", async () => {
    show("req:EXI_1");
    expect(await screen.findByText("Part req:EXI_1 EXI_1")).toBeInTheDocument();
    expect(document.querySelector(".is-focus")).not.toBeNull();
    expect(document.querySelector(".docreqs .chip-on")).toHaveTextContent("EXI_1");
  });

  it("falls back on the first section, and on nothing", async () => {
    show("", {
      toc: [{ anchor: "intro", title: "Intro", level: 1 }],
      requirements: [],
      figures: [],
      context: undefined,
    });
    expect(await screen.findByText("Part intro EXI_1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Intro" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Context — what the team knows/)).toHaveValue("");
    cleanup();
    show("", { toc: [] });
    await screen.findByRole("heading", { name: "Title D1" });
    expect(named("docs.show").filter((c) => c.input.anchor)).toHaveLength(1);
    expect(screen.getByText(/Converted from PDF · 0 sections/)).toBeInTheDocument();
  });

  it("shows the reason when a part cannot be read, and when the document cannot be opened", async () => {
    api.routes["docs.show"] = (i) => {
      if (i.anchor) throw new Error("no such anchor");
      return shown();
    };
    mount(<DocDetail id="D1" anchor="§9" docs={docs} onAnchor={vi.fn()} onChanged={vi.fn()} onReindex={vi.fn()} />);
    expect(await screen.findByText("no such anchor")).toBeInTheDocument();
    cleanup();
    delete api.routes["docs.show"];
    mount(<DocDetail id="DX" anchor="" docs={docs} onAnchor={vi.fn()} onChanged={vi.fn()} onReindex={vi.fn()} />);
    expect(screen.getByRole("complementary", { name: "DX details" })).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByText("This document could not be opened")).toBeInTheDocument();
    expect(screen.getByText("Unknown command docs.show")).toBeInTheDocument();
  });

  it("saves status, binding, superseded-by, amends and the context", async () => {
    let saved = doc("D1", { amends: ["D2"] });
    api.routes["docs.set"] = (i) => {
      saved = { ...saved, ...(i as Partial<DocRef>) };
      return saved;
    };
    const { onChanged } = show();
    await screen.findByRole("heading", { name: "Title D1" });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "draft" } });
    await waitFor(() => expect(named("docs.set")[0]?.input).toEqual({ id: "D1", status: "draft" }));
    fireEvent.change(screen.getByLabelText("Binding"), { target: { value: "informative" } });
    await waitFor(() => expect(named("docs.set")[1]?.input).toEqual({ id: "D1", binding: "informative" }));
    const sup = screen.getByLabelText("Superseded by");
    expect(
      within(sup)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["— none", "C-D2 Title D2", "C-D3 Title D3"]);
    fireEvent.change(sup, { target: { value: "D3" } });
    await waitFor(() => expect(named("docs.set")[2]?.input).toEqual({ id: "D1", supersededBy: "D3" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a document" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Documents this one amends" })).getByRole("menuitem", {
        name: "C-D3 Title D3",
      }),
    );
    await waitFor(() => expect(named("docs.set")[3]?.input).toEqual({ id: "D1", amends: ["D2", "D3"] }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add a document" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Remove D2" }));
    await waitFor(() => expect(named("docs.set")[4]?.input).toEqual({ id: "D1", amends: ["D3"] }));
    const ctx = screen.getByLabelText(/Context — what the team knows/);
    fireEvent.blur(ctx);
    expect(named("docs.set")).toHaveLength(5);
    fireEvent.change(ctx, { target: { value: "new note" } });
    fireEvent.blur(ctx);
    expect(await screen.findByText("Context saved")).toBeInTheDocument();
    expect(named("docs.set")[5]?.input).toEqual({ id: "D1", context: "new note" });
    fireEvent.blur(ctx);
    expect(named("docs.set")).toHaveLength(6);
    expect(onChanged).toHaveBeenCalledTimes(6);
  });

  it("reports a failed save and shows Word documents without a date or amends", async () => {
    show("", { doc: doc("D1", { source: { path: "", sha256: "" } as DocRef["source"] }) });
    await screen.findByRole("heading", { name: "Title D1" });
    expect(screen.getByText(/Converted from Word/)).toBeInTheDocument();
    expect(screen.queryByText("Conversion warnings")).toBeNull();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "draft" } });
    expect(await screen.findByText("Could not save the document")).toBeInTheDocument();
  });

  it("shows the document folder in Explorer on the desktop", async () => {
    const d = fakeDesktop();
    setProject("C:\\proj");
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Show in Explorer" }));
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith("C:\\proj\\docs\\D1"));
  });

  it("ignores answers that arrive after leaving", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    api.routes["docs.show"] = (i) => (i.anchor ? { md: "late" } : shown());
    const f = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        await gate;
        return f(url, init);
      }),
    );
    const { unmount } = render(
      <DocDetail id="D1" anchor="" docs={docs} onAnchor={vi.fn()} onChanged={vi.fn()} onReindex={vi.fn()} />,
    );
    unmount();
    release();
    await waitFor(() => expect(named("docs.show")).toHaveLength(1));
  });
});

describe("DocDetail with tracked ids", () => {
  afterEach(() => setTraces(null));
  const trace = (id: string, label: string) =>
    ({ id, label, patterns: [], field: label, origin: "declared", column: "in-xray", found: 0, docs: 0 }) as never;
  const shown = () => ({
    doc: doc("D1"),
    context: "",
    toc: [{ anchor: "§1", title: "One", level: 1 }],
    requirements: ["EXI_1"],
    figures: [],
    md: "",
  });

  it("lists each tracked kind found in the document and goes to its anchor", async () => {
    setTraces([trace("requirement", "Requirement"), trace("alarm", "Alarm"), trace("uc", "Use case")]);
    api.routes["docs.show"] = (i) => (i.anchor ? { md: "Texte EXI_1" } : shown());
    api.routes["traces.find"] = (i) => {
      if (i.trace === "uc") throw new Error("scan failed");
      return {
        items:
          i.trace === "requirement"
            ? [
                { id: "EXI_1", doc: "D1", anchor: "§1", context: "c1" },
                { id: "EXI_9", doc: "D1", anchor: "§9", context: "c9" },
              ]
            : [{ id: "ALM-1", doc: "D1", anchor: "", context: "" }],
      };
    };
    const onAnchor = vi.fn();
    mount(
      <DocDetail id="D1" anchor="§9" docs={[doc("D1")]} onAnchor={onAnchor} onChanged={vi.fn()} onReindex={vi.fn()} />,
    );
    expect(await screen.findByText("Requirement ids (2)")).toBeInTheDocument();
    expect(screen.getByText("Alarm ids (1)")).toBeInTheDocument();
    expect(screen.queryByText(/Use case ids/)).toBeNull();
    expect(screen.getByText(/2 requirement ids · 1 alarm id · 0 use case ids · 0 figures/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "EXI_9" })).toHaveClass("chip-on");
    const reqBox = screen.getByText("Requirement ids (2)").closest(".formfield") as HTMLElement;
    fireEvent.click(within(reqBox).getByRole("button", { name: "EXI_1" }));
    expect(onAnchor).toHaveBeenCalledWith("req:EXI_1");
    fireEvent.click(screen.getByRole("button", { name: "EXI_9" }));
    expect(onAnchor).toHaveBeenCalledWith("§9");
    fireEvent.click(screen.getByRole("button", { name: "ALM-1" }));
    expect(onAnchor).toHaveBeenCalledTimes(2);
    expect(named("traces.find")[0].input).toEqual({ trace: "requirement", doc: "D1", limit: 2000 });
  });

  it("a project that tracks no requirement shows no requirement chips in the text", async () => {
    setTraces([]);
    api.routes["docs.show"] = (i) => (i.anchor ? { md: "Texte EXI_1" } : shown());
    mount(
      <DocDetail id="D1" anchor="" docs={[doc("D1")]} onAnchor={vi.fn()} onChanged={vi.fn()} onReindex={vi.fn()} />,
    );
    expect(await screen.findByText("Texte EXI_1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "EXI_1" })).toBeNull();
    expect(screen.queryByText(/ids \(/)).toBeNull();
  });

  it("ignores a scan that ends after leaving", async () => {
    setTraces([trace("alarm", "Alarm")]);
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    api.routes["docs.show"] = () => shown();
    api.routes["traces.find"] = () => ({ items: [] });
    const f = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("traces/find")) await gate;
        return f(url, init);
      }),
    );
    const { unmount } = render(
      <DocDetail id="D1" anchor="" docs={[]} onAnchor={vi.fn()} onChanged={vi.fn()} onReindex={vi.fn()} />,
    );
    unmount();
    release();
    await waitFor(() => expect(named("traces.find")).toHaveLength(1));
  });
});

describe("Documents screen", () => {
  const status =
    (over: Record<string, unknown> = {}) =>
    () => ({ exists: true, degraded: null, ...over });
  const detail = () => {
    api.routes["docs.show"] = (i) =>
      i.anchor ? { md: "x" } : { doc: doc(String(i.id)), context: "", toc: [], requirements: [], figures: [], md: "" };
  };

  it("lists documents with fallbacks, selects from the route and navigates", async () => {
    api.routes["docs.list"] = () => [
      doc("D1", {
        status: "weird" as DocRef["status"],
        binding: "odd" as DocRef["binding"],
        indexed: "gone" as DocRef["indexed"],
      }),
      doc("D2", { warnings: ["w1", "w2"] }),
    ];
    api.routes["rag.status"] = status({ degraded: "No vectors yet" });
    detail();
    const { app: a } = mount(<DocumentsScreen />, { route: { screen: "documents", arg: "D2#§5" } });
    const list = await screen.findByRole("region", { name: "Document list" });
    await waitFor(() => expect(within(list).getByText("weird")).toBeInTheDocument());
    expect(within(list).getByText("odd")).toBeInTheDocument();
    expect(within(list).getByText("Not indexed")).toBeInTheDocument();
    expect(within(list).getByText("2")).toBeInTheDocument();
    expect(screen.getByText("No vectors yet")).toBeInTheDocument();
    expect(screen.getByText(/^2 documents ·/)).toBeInTheDocument();
    const rows = within(list).getAllByRole("row");
    expect(rows[2]).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(named("docs.show").find((c) => c.input.anchor)?.input).toEqual({ id: "D2", anchor: "§5" }),
    );
    fireEvent.click(rows[1]);
    expect(a.navigate).toHaveBeenCalledWith("documents", "D1");
    fireEvent.keyDown(rows[1], { key: "Enter" });
    fireEvent.keyDown(rows[1], { key: "x" });
    expect(a.navigate).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Choose a search pack" }));
    expect(a.navigate).toHaveBeenCalledWith("settings", "models");
  });

  it("goes to an anchor through the detail and shows the first document on other routes", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    api.routes["rag.status"] = status();
    api.routes["docs.show"] = (i) =>
      i.anchor
        ? { md: "x" }
        : {
            doc: doc("D1"),
            context: "",
            toc: [{ anchor: "§1", title: "One", level: 1 }],
            requirements: [],
            figures: [],
            md: "",
          };
    const { app: a } = mount(<DocumentsScreen />, { route: { screen: "tests" } });
    fireEvent.click(await screen.findByRole("button", { name: "1 One" }));
    expect(a.navigate).toHaveBeenCalledWith("documents", "D1#§1");
    expect(screen.getByText(/^1 document ·/)).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /words only/ })).toBeNull();
  });

  it("an unlisted document id shows no detail; lists that fail or are not arrays are empty", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    mount(<DocumentsScreen />, { route: { screen: "documents", arg: "NOPE" } });
    await screen.findByText("Title D1");
    expect(screen.queryByRole("complementary")).toBeNull();
    cleanup();
    api.routes["docs.list"] = () => ({ not: "a list" });
    const { app: a } = mount(<DocumentsScreen />);
    expect(await screen.findByRole("heading", { name: "Start with the specifications" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Or import a CSV of existing tests" }));
    expect(a.navigate).toHaveBeenCalledWith("import");
    cleanup();
    delete api.routes["docs.list"];
    mount(<DocumentsScreen />);
    expect(await screen.findByText("Could not list the documents")).toBeInTheDocument();
  });

  it("reloads when a document job ends, not for others", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    mount(<DocumentsScreen />);
    await screen.findByText("Title D1");
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    const before = named("docs.list").length;
    const status = (kind: string, s: string): JobEvent => ({
      jobId: "j",
      at,
      type: "status",
      job: { id: "j", kind, subject: "", status: s as "done", startedAt: at },
    });
    emit(status("rag-index", "running"));
    emit(status("check", "done"));
    emit({ jobId: "j", at, type: "progress", message: "x" });
    expect(named("docs.list")).toHaveLength(before);
    emit(status("docs.add", "done"));
    await waitFor(() => expect(named("docs.list")).toHaveLength(before + 1));
  });

  it("drag and drop: shows the veil only for files, adds the dropped files", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    const { container } = mount(<DocumentsScreen />);
    await screen.findByText("Title D1");
    const zone = container.querySelector(".docs-screen") as HTMLElement;
    fireEvent.dragOver(zone, { dataTransfer: { types: ["text/plain"] } });
    expect(container.querySelector(".dropveil")).toBeNull();
    fireEvent.dragOver(zone, { dataTransfer: { types: ["Files"] } });
    expect(container.querySelector(".dropveil")).not.toBeNull();
    fireEvent.dragLeave(zone.querySelector("table") as HTMLElement);
    expect(container.querySelector(".dropveil")).not.toBeNull();
    fireEvent.dragLeave(zone);
    expect(container.querySelector(".dropveil")).toBeNull();
    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "notes.txt")] } });
    expect(await screen.findByText("Only Word (.docx) and PDF files can be added")).toBeInTheDocument();
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "spec.docx")] } });
    expect(await screen.findByText(/Adding spec.docx stopped/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss spec.docx" }));
  });

  it("Add documents: the file input in a browser, the native picker on the desktop", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    mount(<DocumentsScreen />);
    await screen.findByText("Title D1");
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Add documents" }));
    expect(click).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Choose Word or PDF files to add"), {
      target: { files: [new File(["x"], "a.txt")] },
    });
    expect(await screen.findByText("a.txt")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose Word or PDF files to add"), { target: { files: null } });
    const d = fakeDesktop({ files: ["C:\\x\\b.txt"] });
    fireEvent.click(screen.getByRole("button", { name: "Add documents" }));
    await waitFor(() =>
      expect(d.pickFiles).toHaveBeenCalledWith({
        title: "Add documents",
        filters: [{ name: "Word or PDF", extensions: ["docx", "pdf"] }],
        multiple: true,
      }),
    );
    expect(await screen.findByText("b.txt")).toBeInTheDocument();
  });

  it("adds from a path: cancel, Escape, then a quoted path", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    mount(<DocumentsScreen />);
    await screen.findByText("Title D1");
    fireEvent.click(screen.getByRole("button", { name: "Add from a path" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add from a path" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Add from a path" }));
    const add = within(screen.getByRole("dialog")).getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Path of the file"), { target: { value: ' "C:\\d\\spec.docx" ' } });
    fireEvent.click(add);
    await waitFor(() => expect(named("docs.add")[0]?.input).toEqual({ file: "C:\\d\\spec.docx" }));
    const row = await screen.findByText("spec.docx");
    expect(await within(row.closest("tr") as HTMLElement).findByText(/Adding spec.docx stopped/)).toBeInTheDocument();
    expect(within(row.closest("tr") as HTMLElement).getByText("Converting", { selector: "li" })).toHaveClass(
      "is-failed",
    );
    expect(within(row.closest("tr") as HTMLElement).getByText("Not added")).toBeInTheDocument();
    expect(within(row.closest("tr") as HTMLElement).queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss spec.docx" }));
    expect(screen.queryByText("spec.docx")).toBeNull();
  });

  it("follows an upload: converting with progress, indexing, done", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    api.routes["docs.add"] = () => ({ jobId: "add-1" });
    api.routes["rag.index"] = () => ({ jobId: "ix-1" });
    api.routes["jobs.show"] = (i) => ({ job: { id: i.id, kind: "x", subject: "", status: "running", startedAt: at } });
    mount(<DocumentsScreen />);
    await screen.findByText("Title D1");
    fireEvent.click(screen.getByRole("button", { name: "Add from a path" }));
    fireEvent.change(screen.getByLabelText("Path of the file"), { target: { value: "C:/n/new.pdf" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("progressbar", { name: "Converting" })).toBeInTheDocument();
    expect(screen.getByText(/1 being added/)).toBeInTheDocument();
    const row = screen.getByText("new.pdf").closest("tr") as HTMLElement;
    expect(within(row).getAllByRole("cell")).toHaveLength(1);
    expect(within(row).getByRole("cell")).toHaveAttribute("colspan", "5");
    const step = (name: string) => within(row).getByText(name, { selector: "li" });
    expect(step("Converting")).toHaveAttribute("aria-current", "step");
    expect(step("Indexing")).toHaveClass("is-todo");
    expect(within(row).getByText("New document")).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    emit({ jobId: "add-1", at, type: "progress", message: "Converting docx", done: 1, total: 2 });
    expect(await within(row).findByText("50%")).toBeInTheDocument();
    expect(within(row).getByText("Converting docx")).toBeInTheDocument();
    expect(within(row).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    emit({ jobId: "add-1", at, type: "progress", message: "Converting" });
    expect(within(row).queryByText("50%")).toBeNull();
    const done = (id: string, result: unknown): JobEvent => ({
      jobId: id,
      at,
      type: "status",
      job: { id, kind: "x", subject: "", status: "done", startedAt: at, result },
    });
    emit(done("add-1", { id: "NEW" }));
    expect(await screen.findByRole("progressbar", { name: "Indexing" })).toBeInTheDocument();
    const indexing = screen.getByText("new.pdf").closest("tr") as HTMLElement;
    expect(within(indexing).getByText("NEW")).toBeInTheDocument();
    expect(within(indexing).getByText("Converting", { selector: "li" })).toHaveClass("is-done");
    expect(within(indexing).getByText("Indexing", { selector: "li" })).toHaveAttribute("aria-current", "step");
    emit({ jobId: "ix-1", at, type: "progress", message: "Embedding passages", done: 1, total: 4 });
    expect(await within(indexing).findByText("25%")).toBeInTheDocument();
    expect(within(indexing).getByText("Embedding passages")).toBeInTheDocument();
    emit(done("ix-1", {}));
    expect(await screen.findByText("Added and indexed")).toBeInTheDocument();
    const added = screen.getByText("new.pdf").closest("tr") as HTMLElement;
    expect(within(added).getByText("Indexing", { selector: "li" })).toHaveClass("is-done");
    expect(within(added).getByRole("progressbar", { name: "Added" })).toHaveAttribute("aria-valuenow", "100");
  });

  it("a document listed while its upload still runs shows once, as the upload, then as itself", async () => {
    let listed = false;
    const old = doc("OLD", { title: "Older copy", source: { path: "C:/x/early.docx", sha256: "", file: "" } });
    let early: DocRef | null = null;
    api.routes["docs.list"] = () => {
      if (listed && !early)
        early = doc("EARLY", {
          title: "Early bird",
          status: "draft",
          indexed: "missing",
          warnings: ["one"],
          source: { path: "C:\\n\\early.docx", sha256: "", file: "source.docx" },
          convertedAt: new Date().toISOString(),
        });
      return early ? [old, early] : [old];
    };
    detail();
    api.routes["docs.add"] = () => ({ jobId: "add-3" });
    api.routes["rag.index"] = () => ({ jobId: "ix-3" });
    api.routes["jobs.show"] = (i) => ({ job: { id: i.id, kind: "x", subject: "", status: "running", startedAt: at } });
    const { app: a } = mount(<DocumentsScreen />);
    await screen.findByText("Older copy");
    fireEvent.click(screen.getByRole("button", { name: "Add from a path" }));
    fireEvent.change(screen.getByLabelText("Path of the file"), { target: { value: "C:\\n\\early.docx" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add" }));
    const list = await screen.findByRole("region", { name: "Document list" });
    await within(list).findByText("early.docx");
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    listed = true;
    const status = (id: string, kind: string, result?: unknown): JobEvent => ({
      jobId: id,
      at,
      type: "status",
      job: { id, kind, subject: "", status: "done", startedAt: at, result },
    });
    emit(status("fig-3", "describe-figures"));
    await waitFor(() => expect(early).not.toBeNull());
    await waitFor(() => expect(within(list).getAllByRole("row")).toHaveLength(3));
    expect(within(list).queryByText("Early bird")).toBeNull();
    expect(within(list).getByText("Older copy")).toBeInTheDocument();
    const row = within(list).getByText("early.docx").closest("tr") as HTMLElement;
    expect(within(row).getByText("Converting", { selector: "li" })).toHaveAttribute("aria-current", "step");
    fireEvent.click(row);
    expect(a.navigate).toHaveBeenCalledWith("documents", "EARLY");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(a.navigate).toHaveBeenCalledTimes(2);
    emit(status("add-3", "docs.add", { id: "EARLY" }));
    expect(await within(list).findByRole("progressbar", { name: "Indexing" })).toBeInTheDocument();
    expect(within(list).getAllByRole("row")).toHaveLength(3);
    expect(within(list).queryByText("Early bird")).toBeNull();
    emit(status("ix-3", "rag-index", {}));
    expect(await within(list).findByText("Early bird")).toBeInTheDocument();
    expect(within(list).queryByText("early.docx")).toBeNull();
    expect(within(list).getAllByRole("row")).toHaveLength(3);
  });

  it("indexing of a listed document: running state, failure with its fix, reindex, jobs, dismiss", async () => {
    let listed = false;
    api.routes["docs.list"] = () => (listed ? [doc("D1"), doc("NEW2", { title: "Fresh one" })] : [doc("D1")]);
    detail();
    api.routes["docs.add"] = () => {
      listed = true;
      return { id: "NEW2" };
    };
    api.routes["rag.index"] = () => ({ jobId: "ix-2" });
    api.routes["jobs.show"] = (i) => ({ job: { id: i.id, kind: "x", subject: "", status: "running", startedAt: at } });
    const { app: a } = mount(<DocumentsScreen />);
    await screen.findByText("Title D1");
    fireEvent.click(screen.getByRole("button", { name: "Add from a path" }));
    fireEvent.change(screen.getByLabelText("Path of the file"), { target: { value: "C:/n/fresh.docx" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add" }));
    const list = await screen.findByRole("region", { name: "Document list" });
    expect(await within(list).findByRole("progressbar", { name: "Indexing" })).toBeInTheDocument();
    expect(within(list).queryByText("Fresh one")).toBeNull();
    expect(within(list).getAllByText("fresh.docx")).toHaveLength(1);
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    emit({ jobId: "ix-2", at, type: "progress", message: "m", done: 3, total: 4 });
    expect(await within(list).findByText("75%")).toBeInTheDocument();
    emit({
      jobId: "ix-2",
      at,
      type: "status",
      job: { id: "ix-2", kind: "rag-index", subject: "", status: "failed", startedAt: at, error: "model missing" },
    });
    expect(await within(list).findByText("Indexing failed")).toBeInTheDocument();
    expect(
      within(list).getByText(/fresh.docx was added, but search cannot find it yet: model missing/),
    ).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Open Jobs" }));
    expect(a.navigate).toHaveBeenCalledWith("jobs");
    api.routes["rag.index"] = () => {
      throw new Error("still broken");
    };
    fireEvent.click(within(list).getByRole("button", { name: "Reindex" }));
    expect(await within(list).findByText(/still broken/)).toBeInTheDocument();
    expect(within(list).queryByText(/was added/)).toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: "Dismiss the indexing failure of All documents" }));
    expect(within(list).queryByText("Indexing failed")).toBeNull();
  });

  it("an index failure with a fix says what to do", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    const f = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("rag/index"))
          return new Response(JSON.stringify({ error: "No model", fix: "Install a pack" }), { status: 400 });
        return f(url, init);
      }),
    );
    const { container } = mount(<DocumentsScreen />);
    await screen.findByText("Title D1");
    fireEvent.click(
      await within(container.querySelector(".docdetail") as HTMLElement).findByRole("button", { name: "Reindex" }),
    );
    expect(await screen.findByText("Install a pack")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the indexing failure of All documents" }));
  });
});
