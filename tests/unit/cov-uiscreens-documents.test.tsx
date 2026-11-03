// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef, JobEvent } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { docLink } from "../../src/ui/components/sources/PassageView.tsx";
import { importClaude, reindexAll, setImportClaude } from "../../src/ui/lib/uploads.ts";
import { DocDetail } from "../../src/ui/screens/documents/DocDetail.tsx";
import { DocText, FigureChip } from "../../src/ui/screens/documents/DocText.tsx";
import { DocumentsScreen } from "../../src/ui/screens/documents/DocumentsScreen.tsx";
import { ImportClaude } from "../../src/ui/screens/documents/ImportClaude.tsx";
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
  source: { path: "", sha256: "", file: "source.docx" },
  convertedWith: "",
  convertedAt: at,
  warnings: [],
  indexed: "fresh",
  ...over,
});

const boxes = (rects: Record<string, Partial<DOMRect>>) => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const k = Object.keys(rects).find((c) => this.classList.contains(c));
    return { top: 0, bottom: 0, height: 0, ...(k ? rects[k] : {}) } as DOMRect;
  });
  const tops = new Map<Element, number>();
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
    return tops.get(this) ?? 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (this: Element, v: number) {
    tops.set(this, v);
  });
  return { tops };
};

describe("DocText", () => {
  it("renders headings, figures, tables, inline marks and the focus", () => {
    setProject("C:/p");
    const onFigure = vi.fn();
    const md = [
      "## 5.6 Sectionneur",
      "# Title\nwith a second line",
      "![Vue de traction](figures/fig-1.png) <!-- fig fig-1 -->",
      '![Plain](figures/x.png "t")',
      "| a | b |\n| - | - |",
      "Le **sectionneur** est *ouvert* en cas de défaut.",
      "Selon le type de sectionneur, le menu diffère",
      "<!-- only a comment -->",
    ].join("\n\n");
    const { container } = render(<DocText docId="D1" md={md} focus="Selon le  type" onFigure={onFigure} />);
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
    expect(container.querySelectorAll(".is-focus")).toHaveLength(1);
    expect(container.querySelector(".is-focus")).toHaveTextContent("Selon le type de sectionneur");
  });

  it("finds the quote in a table row, across paragraphs, in a heading or a figure, and only once", () => {
    const md = [
      "## 8.1 Boutons",
      "| Bouton | Action |\n| - | - |\n| Valider | Appel de la fonction serveur. |",
      "Une phrase coupée\nici et",
      "continuée là.",
      "![Figure 2 – Vue](figures/f.png) <!-- fig 2 -->",
      "Appel de la fonction serveur.",
    ].join("\n\n");
    const hot = (focus: string) => {
      const { container, unmount } = render(<DocText docId="D" md={md} focus={focus} onFigure={vi.fn()} />);
      const on = [...container.querySelectorAll(".is-focus")].map((e) => `${e.className}|${e.textContent}`);
      unmount();
      return on;
    };
    expect(hot("Appel de la fonction serveur.")).toEqual([
      "doctext-row is-focus|| Valider | Appel de la fonction serveur. |",
    ]);
    expect(hot("coupée ici et continuée là")).toEqual(["doctext-p is-focus|Une phrase coupée\nici et"]);
    expect(hot("Boutons")).toEqual(["h doctext-h is-focus|8.1 Boutons"]);
    expect(hot("Figure 2 – Vue")[0]).toMatch(/^passage-fig is-focus\|/);
    expect(hot(`${"x".repeat(60)} absent`)).toEqual([]);
  });

  it("says when the part is empty; no focus without one", () => {
    const { rerender, container } = render(<DocText docId="D" md={"<!-- x -->\n\n\n"} onFigure={vi.fn()} />);
    expect(screen.getByText("This part of the document is empty.")).toBeInTheDocument();
    rerender(<DocText docId="D" md="**all bold**" onFigure={vi.fn()} />);
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
      { anchor: "§partie-sportive", title: "Partie Sportive", level: 1 },
    ],
    figures: [
      { file: "f", anchor: "fig:fig-1", caption: "Vue", description: "" },
      { file: "g", anchor: "fig:fig-2", caption: "", description: "" },
    ],
    md: "",
    ...over,
  });
  const show = (anchor = "", over: Record<string, unknown> = {}) => {
    const onAnchor = vi.fn();
    const onChanged = vi.fn();
    const onRemoved = vi.fn();
    api.routes["docs.show"] = (i) => (i.anchor ? { md: `Part ${i.anchor}` } : shown(over));
    mount(<DocDetail id="D1" anchor={anchor} onAnchor={onAnchor} onChanged={onChanged} onRemoved={onRemoved} />);
    return { onAnchor, onChanged, onRemoved };
  };

  it("shows the document, its facts and the first sub-section by default", async () => {
    const { onAnchor } = show();
    expect(await screen.findByRole("heading", { name: "Title D1" })).toBeInTheDocument();
    const region = screen.getByRole("region", { name: "C-D1 details" });
    expect(within(region).getByRole("complementary", { name: "Document settings" })).toBeInTheDocument();
    expect(screen.getByText("2026-01-02")).toBeInTheDocument();
    expect(screen.getByText(/Converted from PDF · 3 sections · 2 figures/)).toBeInTheDocument();
    expect(screen.getByText("2 comments dropped")).toBeInTheDocument();
    expect(await screen.findByText("Part §5.6")).toBeInTheDocument();
    const toc = screen.getByRole("navigation", { name: "Sections" });
    expect(within(toc).getByRole("button", { name: "5.6 Sectionneur" })).toHaveAttribute("aria-current", "true");
    expect(within(toc).getByRole("button", { name: "5.6 Sectionneur" })).toHaveClass("toc-on");
    expect(within(toc).getByRole("button", { name: "5.6 Sectionneur" })).not.toHaveClass("toc-chapter");
    expect(within(toc).getByRole("button", { name: "5 Traction" })).toHaveClass("toc-chapter");
    fireEvent.click(within(toc).getByRole("button", { name: "5 Traction" }));
    expect(onAnchor).toHaveBeenCalledWith("§5");
    fireEvent.click(within(toc).getByRole("button", { name: "Partie Sportive" }));
    expect(onAnchor).toHaveBeenCalledWith("§partie-sportive");
    expect(screen.queryByRole("button", { name: "Reindex" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show the document list" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sections" })).toBeNull();
  });

  it("reads the document again when a job changed its files, keeping it shown meanwhile", async () => {
    show();
    expect(await screen.findByText("Part §5.6")).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    const whole = () => named("docs.show").filter((c) => !c.input.anchor).length;
    emit({ jobId: "j", at, type: "changed", paths: ["docs/D2/doc.md", "docs/D10/doc.md"] });
    expect(whole()).toBe(1);
    api.routes["docs.show"] = (i) => (i.anchor ? { md: `New ${i.anchor}` } : shown());
    emit({ jobId: "j", at, type: "changed", paths: ["docs/D1/doc.md"] });
    expect(screen.getByRole("heading", { name: "Title D1" })).toBeInTheDocument();
    expect(await screen.findByText("New §5.6")).toBeInTheDocument();
    expect(whole()).toBe(2);
  });

  it("opens an anchor that is no section: no section is marked and there is nothing to step to", async () => {
    show("page:3");
    expect(await screen.findByText("Part page:3")).toBeInTheDocument();
    expect(document.querySelector(".toc-on")).toBeNull();
    expect(screen.queryByText(/section \d+ of/)).toBeNull();
    expect(screen.getByRole("button", { name: "Previous section" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next section" })).toBeDisabled();
  });

  it("steps to the previous and next section, with the chapter it belongs to", async () => {
    const { onAnchor } = show();
    expect(await screen.findByText("Traction · section 2 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous section" }));
    expect(onAnchor).toHaveBeenLastCalledWith("§5");
    fireEvent.click(screen.getByRole("button", { name: "Next section" }));
    expect(onAnchor).toHaveBeenLastCalledWith("§partie-sportive");
    cleanup();
    show("§5");
    expect(await screen.findByText("section 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous section" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next section" })).toBeEnabled();
    cleanup();
    show("§partie-sportive");
    expect(await screen.findByText(/section 3 of 3$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous section" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next section" })).toBeDisabled();
  });

  it("the Figures view lists the figures, filters them, and opens one in the text", async () => {
    const { onAnchor } = show("", {
      figures: [
        { file: "figures/f.png", anchor: "fig:fig-1", caption: "Vue", description: "Une vue de traction" },
        { file: "", anchor: "fig:fig-2", caption: "", description: " " },
      ],
    });
    await screen.findByText("Part §5.6");
    const views = screen.getByRole("group", { name: "Document views" });
    expect(within(views).getByRole("button", { name: "Text" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(views).getByRole("button", { name: /^Figures/ }));
    expect(within(views).getByRole("button", { name: /^Figures/ })).toHaveTextContent("Figures2");
    expect(screen.queryByText("Part §5.6")).toBeNull();
    const grid = document.querySelector(".docfigs-grid") as HTMLElement;
    const figs = () => within(grid).queryAllByRole("button");
    expect(figs()).toHaveLength(2);
    expect(figs()[0]).toHaveAttribute("title", "Une vue de traction");
    expect(figs()[0]).toHaveTextContent("Vuefig:fig-1");
    expect(figs()[0].querySelector("img")).toHaveAttribute("src", "/files/docs/D1/figures/f.png");
    expect(figs()[1]).toHaveAttribute("title", " ");
    expect(figs()[1]).toHaveTextContent(/^fig:fig-2$/);
    expect(figs()[1].querySelector("img")).toBeNull();
    const which = screen.getByRole("group", { name: "Which figures" });
    expect(within(which).getByRole("button", { name: /^All/ })).toHaveTextContent("All2");
    fireEvent.click(within(which).getByRole("button", { name: /^Described/ }));
    expect(figs().map((b) => b.textContent)).toEqual(["Vuefig:fig-1"]);
    fireEvent.click(within(which).getByRole("button", { name: /^Not described/ }));
    expect(figs().map((b) => b.textContent)).toEqual(["fig:fig-2"]);
    expect(screen.queryByText("No figure here.")).toBeNull();
    fireEvent.click(figs()[0]);
    expect(onAnchor).toHaveBeenLastCalledWith("fig:fig-2");
    expect(within(views).getByRole("button", { name: "Text" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("Part §5.6")).toBeInTheDocument();
  });

  it("the Figures view says when a filter leaves no figure; titles fall back on the caption, then the anchor", async () => {
    show("", {
      figures: [
        { file: "", anchor: "fig:a", caption: "Plan", description: "" },
        { file: "", anchor: "fig:b", caption: "", description: "" },
      ],
    });
    await screen.findByText("Part §5.6");
    fireEvent.click(screen.getByRole("button", { name: /^Figures/ }));
    const grid = document.querySelector(".docfigs-grid") as HTMLElement;
    expect(
      within(grid)
        .getAllByRole("button")
        .map((b) => b.getAttribute("title")),
    ).toEqual(["Plan", "fig:b"]);
    fireEvent.click(screen.getByRole("button", { name: /^Described/ }));
    expect(within(grid).queryAllByRole("button")).toEqual([]);
    expect(screen.getByText("No figure here.")).toBeInTheDocument();
  });

  it("a document without figures has no Figures view", async () => {
    show("", { figures: [] });
    await screen.findByText("Part §5.6");
    expect(screen.queryByRole("group", { name: "Document views" })).toBeNull();
    expect(screen.getByText(/· 0 figures/)).toBeInTheDocument();
  });

  it("falls back on the first section, and on nothing", async () => {
    show("", {
      toc: [{ anchor: "intro", title: "Intro", level: 1 }],
      figures: [],
      context: undefined,
    });
    expect(await screen.findByText("Part intro")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Intro" })).toBeInTheDocument();
    expect(screen.getByLabelText("Note for this document")).toHaveValue("");
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
    mount(<DocDetail id="D1" anchor="§9" onAnchor={vi.fn()} onChanged={vi.fn()} onRemoved={vi.fn()} />);
    expect(await screen.findByText("no such anchor")).toBeInTheDocument();
    cleanup();
    delete api.routes["docs.show"];
    mount(<DocDetail id="DX" anchor="" onAnchor={vi.fn()} onChanged={vi.fn()} onRemoved={vi.fn()} />);
    expect(screen.getByRole("region", { name: "DX details" })).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByText("This document could not be opened")).toBeInTheDocument();
    expect(screen.getByText("Unknown command docs.show")).toBeInTheDocument();
  });

  it("saves the status, the note and the saved contexts", async () => {
    let saved = doc("D1");
    api.routes["docs.set"] = (i) => {
      saved = { ...saved, ...(i as Partial<DocRef>) };
      return saved;
    };
    api.routes["contexts.list"] = () => [{ id: "glossary", name: "Glossary", shared: false }];
    const { onChanged } = show("", { contexts: ["glossary"] });
    await screen.findByRole("heading", { name: "Title D1" });
    const st = screen.getByRole("group", { name: "Status" });
    expect(
      within(st)
        .getAllByRole("button")
        .map((o) => o.textContent),
    ).toEqual(["Draft", "Submitted", "Validated"]);
    expect(within(st).getByRole("button", { name: "Validated", pressed: true })).toBeInTheDocument();
    expect(screen.queryByLabelText("Binding")).toBeNull();
    expect(screen.queryByLabelText("Superseded by")).toBeNull();
    fireEvent.click(within(st).getByRole("button", { name: "Validated" }));
    fireEvent.click(within(st).getByRole("button", { name: "Draft" }));
    await waitFor(() => expect(named("docs.set")[0]?.input).toEqual({ id: "D1", status: "draft" }));
    await waitFor(() => expect(within(st).getByRole("button", { name: "Draft", pressed: true })).toBeInTheDocument());
    expect(screen.queryByText("Amends")).toBeNull();
    expect(screen.getByText(/what the team knows about this document/i)).toBeInTheDocument();
    const ctx = screen.getByLabelText("Note for this document");
    fireEvent.blur(ctx);
    expect(named("docs.set")).toHaveLength(1);
    fireEvent.change(ctx, { target: { value: "new note" } });
    fireEvent.blur(ctx);
    expect(await screen.findByText("Context saved")).toBeInTheDocument();
    expect(named("docs.set")[1]?.input).toEqual({ id: "D1", context: "new note" });
    fireEvent.blur(ctx);
    expect(named("docs.set")).toHaveLength(2);
    expect(onChanged).toHaveBeenCalledTimes(2);
    fireEvent.change(ctx, { target: { value: "unsaved note" } });
    fireEvent.click(await screen.findByRole("button", { name: "Leave Glossary out of this document" }));
    await waitFor(() =>
      expect(named("docs.set")[2]?.input).toEqual({ id: "D1", contexts: [], context: "unsaved note" }),
    );
    expect(screen.queryByText("Glossary")).toBeNull();
  });

  it("leaving a saved context out with the note untouched saves the list alone", async () => {
    api.routes["docs.set"] = (i) => ({ ...doc("D1"), ...(i as Partial<DocRef>) });
    api.routes["contexts.list"] = () => [{ id: "glossary", name: "Glossary", shared: false }];
    show("", { contexts: ["glossary"] });
    fireEvent.click(await screen.findByRole("button", { name: "Leave Glossary out of this document" }));
    await waitFor(() => expect(named("docs.set")[0]?.input).toEqual({ id: "D1", contexts: [] }));
  });

  it("⋯ › Delete asks, then removes the document; Cancel and a failure leave it", async () => {
    let fail = true;
    api.routes["docs.remove"] = (i) => {
      if (fail && !i.dryRun) throw new Error("locked");
      return { removed: "D1", folder: "docs/D1", unlinked: [], citedBy: [], dryRun: !!i.dryRun };
    };
    const { onRemoved } = show();
    await screen.findByRole("heading", { name: "Title D1" });
    const more = () => fireEvent.click(screen.getByRole("button", { name: "More actions for this document" }));
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("dialog", { name: "Delete this document?" })).toHaveTextContent(/from the index/);
    expect(await screen.findByText("No test cites it.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(named("docs.remove").map((c) => c.input)).toEqual([{ id: "D1", dryRun: true }]);
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Could not delete the document")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onRemoved).not.toHaveBeenCalled();
    fail = false;
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(named("docs.remove").at(-1)?.input).toEqual({ id: "D1" });
    expect(screen.getByText("C-D1 deleted")).toBeInTheDocument();
  });

  it("Delete lists the tests that cite the document, then says they were re-checked", async () => {
    const t = (n: number, review = "draft") => ({ id: `local-${n}`, summary: `Test ${n}`, review, steps: 1 });
    const cited = [{ ...t(0, "validated"), key: "T-1" }, ...Array.from({ length: 9 }, (_, i) => t(i + 1))];
    api.routes["docs.remove"] = (i) => ({
      removed: "D1",
      folder: "docs/D1",
      unlinked: ["D2"],
      citedBy: cited,
      dryRun: !!i.dryRun,
    });
    const { onRemoved } = show();
    await screen.findByRole("heading", { name: "Title D1" });
    fireEvent.click(screen.getByRole("button", { name: "More actions for this document" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    const list = await screen.findByRole("list", { name: "Tests that cite this document" });
    const dialog = screen.getByRole("dialog", { name: "Delete this document?" });
    expect(dialog).toHaveTextContent("10 tests cite it, 1 of them validated");
    expect(within(list).getAllByRole("listitem")).toHaveLength(8);
    expect(within(list).getByText("T-1")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("and 2 more");
    expect(dialog).toHaveTextContent("This document amends it and will no longer name it: D2");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(screen.getByText(/10 tests citing it were re-checked/)).toBeInTheDocument();
  });

  it("Delete still works when the citing tests cannot be listed; one citing test reads in the singular", async () => {
    api.routes["docs.remove"] = (i) => {
      if (i.dryRun) throw new Error("tests unreadable");
      return {
        removed: "D1",
        folder: "",
        unlinked: [],
        citedBy: [{ id: "a", summary: "A", review: "draft", steps: 2 }],
      };
    };
    const { onRemoved } = show();
    await screen.findByRole("heading", { name: "Title D1" });
    fireEvent.click(screen.getByRole("button", { name: "More actions for this document" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText(/could not be listed: tests unreadable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(screen.getByText(/1 test citing it was re-checked: its sources/)).toBeInTheDocument();
  });

  it("Delete with one citing test and several amending documents", async () => {
    api.routes["docs.remove"] = (i) => ({
      removed: "D1",
      folder: "",
      unlinked: ["D2", "D3"],
      citedBy: [{ id: "a", summary: "A", review: "draft", steps: 1 }],
      dryRun: !!i.dryRun,
    });
    show();
    await screen.findByRole("heading", { name: "Title D1" });
    fireEvent.click(screen.getByRole("button", { name: "More actions for this document" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this document?" });
    await waitFor(() => expect(dialog).toHaveTextContent("1 test cites it."));
    expect(dialog).toHaveTextContent("These documents amend it and will no longer name it: D2, D3");
  });

  it("reports a failed save and shows Word documents without a date or amends", async () => {
    show("", { doc: doc("D1", { source: { path: "", sha256: "" } as DocRef["source"] }) });
    await screen.findByRole("heading", { name: "Title D1" });
    expect(screen.getByText(/Converted from Word/)).toBeInTheDocument();
    expect(screen.queryByText("Conversion warnings")).toBeNull();
    fireEvent.click(within(screen.getByRole("group", { name: "Status" })).getByRole("button", { name: "Draft" }));
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
      <DocDetail id="D1" anchor="" onAnchor={vi.fn()} onChanged={vi.fn()} onRemoved={vi.fn()} />,
    );
    unmount();
    release();
    await waitFor(() => expect(named("docs.show")).toHaveLength(1));
  });
});

describe("Documents screen", () => {
  const status =
    (over: Record<string, unknown> = {}) =>
    () => ({ exists: true, degraded: null, ...over });
  const detail = () => {
    api.routes["docs.show"] = (i) =>
      i.anchor ? { md: "x" } : { doc: doc(String(i.id)), context: "", toc: [], figures: [], md: "" };
  };

  it("lists documents with fallbacks, selects from the route and navigates", async () => {
    api.routes["docs.list"] = () => [
      doc("D1", {
        status: "weird" as DocRef["status"],
        indexed: "gone" as DocRef["indexed"],
      }),
      doc("D2", { warnings: ["w1", "w2"] }),
    ];
    api.routes["rag.status"] = status({ degraded: "No vectors yet" });
    detail();
    const { app: a } = mount(<DocumentsScreen />, { route: { screen: "documents", arg: "D2#§5" } });
    const list = await screen.findByRole("region", { name: "Document list" });
    await waitFor(() => expect(within(list).getByText("weird")).toBeInTheDocument());
    expect(within(list).queryByRole("columnheader", { name: "Binding" })).toBeNull();
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
            figures: [],
            md: "",
          };
    const { app: a } = mount(<DocumentsScreen />, { route: { screen: "tests" } });
    fireEvent.click(await screen.findByRole("button", { name: "1 One" }));
    expect(a.navigate).toHaveBeenCalledWith("documents", "D1#§1");
    expect(screen.getByText(/^1 document ·/)).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /words only/ })).toBeNull();
  });

  it("a link to a quoted line opens its section, marks the line and scrolls to it at once", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    api.routes["rag.status"] = status();
    api.routes["docs.show"] = (i) =>
      i.anchor
        ? { md: "Première ligne.\n\nLa **deuxième** ligne,\ncitée.\n\nTroisième." }
        : {
            doc: doc("D1"),
            context: "",
            toc: [{ anchor: "§1", title: "One", level: 1 }],
            figures: [],
            md: "",
          };
    const { tops } = boxes({
      docpart: { top: 100, bottom: 300, height: 200 },
      "is-focus": { top: 500, bottom: 520, height: 20 },
      doctoc: { top: 0, bottom: 100, height: 100 },
      "toc-on": { top: 150, bottom: 170, height: 20 },
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
    mount(<DocumentsScreen />, {
      route: { screen: "documents", arg: docLink("D1", "§1", " la deuxième ligne, citée ") },
    });
    expect(await screen.findByText("Troisième.")).toBeInTheDocument();
    expect(named("docs.show").find((c) => c.input.anchor)?.input).toEqual({ id: "D1", anchor: "§1" });
    expect(document.querySelectorAll(".is-focus")).toHaveLength(1);
    expect(document.querySelector(".is-focus")).toHaveTextContent("La deuxième ligne, citée.");
    const part = document.querySelector(".docpart") as HTMLElement;
    expect(tops.get(part)).toBe(310);
    expect(tops.get(document.querySelector(".doctoc") as HTMLElement)).toBe(70);
    expect(watch.observe).toHaveBeenCalledWith(document.querySelector(".docs-body"));
    expect(watch.observe).toHaveBeenCalledWith(document.querySelector(".doctext"));
    watch.cb();
    expect(tops.get(part)).toBe(620);
    fireEvent.wheel(window);
    expect(watch.disconnect).toHaveBeenCalled();
  });

  it("a link to a figure marks the section that holds it in the section list", async () => {
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
    const { tops } = boxes({ doctoc: { top: 100, bottom: 200, height: 100 }, "toc-on": { top: 60, bottom: 80 } });
    mount(<DocumentsScreen />, { route: { screen: "documents", arg: "D1#fig:fig-1" } });
    expect(await screen.findByText("La figure du sectionneur.")).toBeInTheDocument();
    expect(tops.get(document.querySelector(".doctoc") as HTMLElement)).toBe(-40);
    expect(screen.getByRole("button", { name: "2 Two" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "1 One" })).not.toHaveAttribute("aria-current");
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
    const { app: a } = mount(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    fireEvent.click(await screen.findByRole("button", { name: "More actions for this document" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("documents"));
    await waitFor(() => expect(named("docs.list")).toHaveLength(2));
  });

  it("an unlisted document id shows no detail; lists that fail or are not arrays are empty", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    mount(<DocumentsScreen />, { route: { screen: "documents", arg: "NOPE" } });
    await screen.findByText("Title D1");
    expect(screen.queryByRole("region", { name: / details$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show the document list" })).toBeNull();
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

  it("reloads when a job changed a document's files, whatever the job", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    mount(<DocumentsScreen />);
    await screen.findByText("Title D1");
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    const before = named("docs.list").length;
    emit({ jobId: "j", at, type: "changed", paths: ["tests/local-1/test.md"] });
    expect(named("docs.list")).toHaveLength(before);
    emit({ jobId: "j", at, type: "changed", paths: ["docs/D1/doc.md"] });
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
    await waitFor(() => expect(named("docs.add")[0]?.input).toEqual({ file: "C:\\d\\spec.docx", convert: false }));
    const row = await screen.findByText("spec.docx");
    expect(await within(row.closest("tr") as HTMLElement).findByText(/Adding spec.docx stopped/)).toBeInTheDocument();
    expect(within(row.closest("tr") as HTMLElement).getByText("Adding", { selector: "li" })).toHaveClass("is-failed");
    expect(within(row.closest("tr") as HTMLElement).getByText("Not added")).toBeInTheDocument();
    expect(within(row.closest("tr") as HTMLElement).queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss spec.docx" }));
    expect(screen.queryByText("spec.docx")).toBeNull();
  });

  it("adding a document only copies it, then opens it: no conversion, no index", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    api.routes["docs.add"] = () => ({ jobId: "add-1" });
    api.routes["jobs.show"] = (i) => ({ job: { id: i.id, kind: "x", subject: "", status: "running", startedAt: at } });
    const { app: a } = mount(<DocumentsScreen />);
    await screen.findByText("Title D1");
    fireEvent.click(screen.getByRole("button", { name: "Add from a path" }));
    fireEvent.change(screen.getByLabelText("Path of the file"), { target: { value: "C:/n/new.pdf" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("progressbar", { name: "Adding" })).toBeInTheDocument();
    expect(screen.getByText(/1 in progress/)).toBeInTheDocument();
    const row = screen.getByText("new.pdf").closest("tr") as HTMLElement;
    expect(within(row).getByRole("cell")).not.toHaveAttribute("colspan");
    expect(within(row).getByText("Adding", { selector: "li" })).toHaveAttribute("aria-current", "step");
    expect(within(row).queryByText("Indexing", { selector: "li" })).toBeNull();
    expect(within(row).getByText("New document")).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    emit({
      jobId: "add-1",
      at,
      type: "status",
      job: { id: "add-1", kind: "docs.add", subject: "", status: "done", startedAt: at, result: { id: "NEW" } },
    });
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("documents", "NEW"));
    expect(screen.queryByText("new.pdf")).toBeNull();
    expect(named("rag.index")).toEqual([]);
    expect(named("docs.convert")).toEqual([]);
  });

  it("a document listed while its add still runs shows once, as the upload, then as itself", async () => {
    let listed = false;
    const old = doc("OLD", { title: "Older copy", source: { path: "C:/x/other.docx", sha256: "", file: "" } });
    const early = doc("EARLY", {
      title: "early",
      status: "draft",
      indexed: "missing",
      source: { path: "C:\\n\\early.docx", sha256: "", file: "source.docx" },
      convertedAt: "",
    });
    api.routes["docs.list"] = () => (listed ? [old, early] : [old]);
    detail();
    api.routes["docs.add"] = () => ({ jobId: "add-3" });
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
    emit(status("conv-0", "docs.convert"));
    await waitFor(() => expect(within(list).getAllByRole("row")).toHaveLength(3));
    expect(within(list).queryByText("Not converted")).toBeNull();
    const row = within(list).getByText("early.docx").closest("tr") as HTMLElement;
    fireEvent.click(row);
    expect(a.navigate).toHaveBeenCalledWith("documents", "EARLY");
    emit(status("add-3", "docs.add", { id: "EARLY" }));
    expect(await within(list).findByText("Not converted")).toBeInTheDocument();
    expect(within(list).queryByText("early.docx")).toBeNull();
    expect(within(list).getAllByRole("row")).toHaveLength(3);
  });

  it("a document not converted yet: its facts, the job's context, convert and index, failures with their fix", async () => {
    let converted = false;
    const fresh = () =>
      doc("NEW2", {
        title: "fresh",
        source: { path: "C:/n/fresh.docx", sha256: "", file: "source.docx" },
        indexed: "missing",
        convertedAt: converted ? at : "",
      });
    api.routes["docs.list"] = () => [fresh()];
    api.routes["docs.show"] = (i) =>
      i.anchor ? { md: "x" } : { doc: fresh(), context: "", toc: [], figures: [], md: "" };
    api.routes["contexts.list"] = () => [];
    let fail = true;
    api.routes["docs.convert"] = () => {
      if (fail) throw new Error("source missing");
      return { jobId: "conv-2" };
    };
    api.routes["rag.index"] = () => ({ jobId: "ix-2" });
    api.routes["jobs.show"] = (i) => ({ job: { id: i.id, kind: "x", subject: "", status: "running", startedAt: at } });
    const { app: a } = mount(<DocumentsScreen />, { route: { screen: "documents", arg: "NEW2" } });
    const list = await screen.findByRole("region", { name: "Document list" });
    expect(await within(list).findByText("Not converted")).toBeInTheDocument();
    const side = await screen.findByRole("region", { name: "C-NEW2 details" });
    expect(within(side).getByText(/Word file, not converted · fresh.docx/)).toBeInTheDocument();
    expect(within(side).getByLabelText("Note for this document")).toBeInTheDocument();
    expect(within(side).getByText("Not converted yet")).toBeInTheDocument();
    expect(within(side).queryByRole("navigation", { name: "Sections" })).toBeNull();
    expect(within(side).queryByText("Context for this conversion only")).toBeNull();

    fireEvent.click(within(side).getByRole("button", { name: "Convert and index" }));
    await waitFor(() =>
      expect(named("docs.convert")[0]?.input).toEqual({ id: "NEW2", contexts: [], describeFigures: true }),
    );
    expect(await within(list).findByText("Conversion failed")).toBeInTheDocument();
    expect(within(list).getByText(/fresh.docx stays as it was: source missing/)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Dismiss the conversion failure of fresh.docx" }));
    expect(within(list).queryByText("Conversion failed")).toBeNull();
    expect(named("rag.index")).toEqual([]);

    fail = false;
    fireEvent.click(within(side).getByRole("button", { name: "Convert and index" }));
    expect(await within(list).findByRole("progressbar", { name: "Converting" })).toBeInTheDocument();
    const reading = within(side).getByRole("region", { name: "Reading the document" });
    expect(reading).toHaveAttribute("aria-busy", "true");
    expect(within(side).queryByRole("region", { name: "Convert and index" })).toBeNull();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    converted = true;
    emit({
      jobId: "conv-2",
      at,
      type: "status",
      job: { id: "conv-2", kind: "docs.convert", subject: "", status: "done", startedAt: at, result: { id: "NEW2" } },
    });
    expect(await within(list).findByRole("progressbar", { name: "Indexing" })).toBeInTheDocument();
    await waitFor(() => expect(named("rag.index")[0]?.input).toEqual({}));
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
      within(list).getByText(/fresh.docx was converted, but search cannot find it yet: model missing/),
    ).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Open Jobs" }));
    expect(a.navigate).toHaveBeenCalledWith("jobs");
    fireEvent.click(within(list).getByRole("button", { name: "Dismiss the indexing failure of fresh.docx" }));
    expect(within(list).queryByText("Indexing failed")).toBeNull();
  });

  it("while a document converts, the panel shows what is read and locks the rest until it is indexed", async () => {
    let converted = false;
    let described = 0;
    const fresh = () =>
      doc("NEW3", {
        title: "fresh",
        source: { path: "C:/n/fresh.docx", sha256: "", file: "source.docx" },
        indexed: converted ? "fresh" : "missing",
        convertedAt: converted ? at : "",
      });
    const toc = [
      { anchor: "§1", title: "Objet", level: 1 },
      { anchor: "§1.1", title: "Portée", level: 2 },
      { anchor: "§1.1.1", title: "Détail", level: 3 },
      { anchor: "§2", title: "Règles", level: 1 },
    ];
    const figures = ["a", "b", "c"].map((f, i) => ({
      file: `figures/${f}.png`,
      anchor: `fig:${f}`,
      caption: `Figure ${f}`,
      description: i < described ? "seen" : "",
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
    api.routes["docs.convert"] = () => ({ jobId: "conv-5" });
    api.routes["rag.index"] = () => ({ jobId: "ix-5" });
    api.routes["jobs.show"] = (i) => ({
      job: { id: i.id, kind: "x", subject: "", status: "running", startedAt: at, message: "Converting source.docx" },
    });
    mount(<DocumentsScreen />, { route: { screen: "documents", arg: "NEW3" } });
    let side = await screen.findByRole("region", { name: "C-NEW3 details" });
    fireEvent.click(within(side).getByRole("button", { name: "Convert and index" }));
    const reading = await within(side).findByRole("region", { name: "Reading the document" });
    expect(await within(reading).findByText("Converting source.docx")).toBeInTheDocument();
    expect(within(reading).getByRole("listitem", { current: "step" })).toHaveTextContent("Reading the file");
    expect(reading.querySelectorAll(".docread-line")).toHaveLength(6);
    for (const b of within(within(side).getByRole("group", { name: "Status" })).getAllByRole("button"))
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
    expect(figs.querySelectorAll(".is-looking")).toHaveLength(2);
    expect(within(side).queryByRole("button", { name: "Figure a" })).toBeNull();
    expect(within(side).queryByRole("navigation", { name: "Sections" })).toBeNull();

    described = 3;
    converted = true;
    emit({
      jobId: "conv-5",
      at,
      type: "status",
      job: { id: "conv-5", kind: "docs.convert", subject: "", status: "done", startedAt: at, result: { id: "NEW3" } },
    });
    await waitFor(() => expect(named("rag.index")).toHaveLength(1));
    side = await screen.findByRole("region", { name: "C-NEW3 details" });
    const again = await within(side).findByRole("region", { name: "Reading the document" });
    await waitFor(() => expect(within(again).getByRole("listitem", { current: "step" })).toHaveTextContent("Indexing"));
    emit({ jobId: "ix-5", at, type: "progress", message: "Embedding NEW3", done: 2, total: 3 });
    await waitFor(() => expect(again.querySelectorAll(".docread-sec.is-indexed")).toHaveLength(2));
    expect(again.querySelector(".docread-sec.is-now")).toHaveTextContent("2 Règles");
    expect(again.querySelectorAll(".docread-fig.is-done")).toHaveLength(3);
    expect(again.querySelectorAll(".docread-sec.is-new")).toHaveLength(0);

    emit({
      jobId: "ix-5",
      at,
      type: "status",
      job: { id: "ix-5", kind: "rag.index", subject: "", status: "done", startedAt: at },
    });
    expect(await within(side).findByRole("navigation", { name: "Sections" })).toBeInTheDocument();
    expect(within(side).queryByRole("region", { name: "Reading the document" })).toBeNull();
    expect(side).toHaveClass("docdetail-open");
    for (const b of within(within(side).getByRole("group", { name: "Status" })).getAllByRole("button"))
      expect(b).toBeEnabled();
  });

  it("a converted document is converted again from its menu, and the panel closes", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    detail();
    api.routes["contexts.list"] = () => [];
    api.routes["docs.convert"] = () => ({ jobId: "conv-4" });
    api.routes["jobs.show"] = (i) => ({ job: { id: i.id, kind: "x", subject: "", status: "running", startedAt: at } });
    mount(<DocumentsScreen />);
    const side = await screen.findByRole("region", { name: "C-D1 details" });
    expect(within(side).queryByRole("region", { name: "Convert again" })).toBeNull();
    fireEvent.click(within(side).getByRole("button", { name: "More actions for this document" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Convert again…" }));
    const panel = within(side).getByRole("region", { name: "Convert again" });
    fireEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
    expect(within(side).queryByRole("region", { name: "Convert again" })).toBeNull();
    fireEvent.click(within(side).getByRole("button", { name: "More actions for this document" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Convert again…" }));
    const describe = within(side).getByRole("checkbox", { name: "Claude describes the figures not described yet" });
    expect(describe).toBeChecked();
    fireEvent.click(describe);
    fireEvent.click(within(side).getByRole("button", { name: "Convert again and index" }));
    await waitFor(() =>
      expect(named("docs.convert")[0]?.input).toEqual({ id: "D1", contexts: [], describeFigures: false }),
    );
    expect(within(side).queryByRole("region", { name: "Convert again" })).toBeNull();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    emit({
      jobId: "conv-4",
      at,
      type: "status",
      job: { id: "conv-4", kind: "docs.convert", subject: "", status: "failed", startedAt: at, error: "stopped" },
    });
    await waitFor(() => expect(within(side).queryByRole("progressbar", { name: "Converting" })).toBeNull());
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
    mount(<DocumentsScreen />);
    await screen.findByText("Title D1");
    await act(() => reindexAll(() => {}));
    expect(await screen.findByText("Install a pack")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the indexing failure of All documents" }));
  });
});

describe("ImportClaude", () => {
  afterEach(() => setImportClaude({}));

  it("shows the project model at low effort, and keeps what is picked for the next imports", () => {
    mount(<ImportClaude />);
    const effort = screen.getByRole("combobox", { name: "Effort" });
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("sonnet");
    expect(effort).toHaveValue("low");
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), { target: { value: "opus" } });
    fireEvent.change(effort, { target: { value: "high" } });
    expect(importClaude()).toEqual({ model: "opus", effort: "high" });
    cleanup();
    mount(<ImportClaude />, { info: undefined });
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("opus");
    expect(screen.getByRole("combobox", { name: "Effort" })).toHaveValue("high");
    setImportClaude({});
    cleanup();
    mount(<ImportClaude />, { info: undefined });
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("opus");
  });
});
