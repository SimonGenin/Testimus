// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef } from "../../src/core/types.ts";
import type { Action } from "../../src/ui/lib/actions.ts";
import { DocDetail } from "../../src/ui/screens/documents/DocDetail.tsx";
import { DocumentsScreen, foldOf } from "../../src/ui/screens/documents/DocumentsScreen.tsx";
import { clearToasts, mount } from "./cov-uiscreens-helpers.tsx";
import { api, FakeEventSource, fakeFetch } from "./ui-desktop-helpers.tsx";

beforeEach(() => {
  fakeFetch();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  clearToasts();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const at = "2026-11-02T10:00:00.000Z";

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

type Entry = { contentRect: { width: number } };

function sized(width: number) {
  const body = { resize: (_w: number) => {}, disconnect: vi.fn() };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      cb: (e: Entry[]) => void;
      constructor(cb: (e: Entry[]) => void) {
        this.cb = cb;
      }
      observe(el: Element) {
        if (!el.classList.contains("docs-body")) return;
        body.resize = (w) => act(() => this.cb([{ contentRect: { width: w } }]));
        this.cb([{ contentRect: { width } }]);
      }
      disconnect() {
        body.disconnect();
      }
    },
  );
  return body;
}

const listed = (over: Partial<DocRef> = {}) => {
  const docs = [doc("D1", over), doc("D2")];
  api.routes["docs.list"] = () => docs;
  api.routes["rag.status"] = () => ({ exists: true, degraded: null });
  api.routes["docs.show"] = (i) =>
    i.anchor
      ? { md: `Part ${i.anchor}` }
      : {
          doc: docs.find((d) => d.id === i.id),
          context: "",
          toc: [
            { anchor: "§1", title: "One", level: 1 },
            { anchor: "§1.1", title: "Sub", level: 2 },
          ],
          requirements: [],
          figures: [],
          md: "",
        };
};

const bodyOf = (c: HTMLElement) => c.querySelector(".docs-body") as HTMLElement;

describe("foldOf", () => {
  it("folds the outer columns first as the screen narrows", () => {
    expect([Number.POSITIVE_INFINITY, 1300, 1299, 1052, 1051, 752, 751, 0].map((w) => foldOf(w))).toEqual([
      "wide",
      "wide",
      "medium",
      "medium",
      "small",
      "small",
      "tiny",
      "tiny",
    ]);
  });
});

describe("foldOf with dragged widths", () => {
  it("wider columns fold sooner, narrower ones later", () => {
    expect(foldOf(1300, { list: 300, toc: 256, side: 300 })).toBe("medium");
    expect(foldOf(1160, { list: 200, toc: 200, side: 260 })).toBe("wide");
    expect(foldOf(700, { list: 248, toc: 180, side: 300 })).toBe("small");
  });
});

describe("Documents screen resizing", () => {
  it("wide: the sections and the settings have their own edges, at the widths last chosen", async () => {
    listed();
    localStorage.setItem("testimus.docsTocWidth", "200");
    localStorage.setItem("testimus.docsSideWidth", "360");
    const { container } = mount(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    localStorage.removeItem("testimus.docsTocWidth");
    localStorage.removeItem("testimus.docsSideWidth");
    await screen.findByText("Part §1.1");
    expect(bodyOf(container).style.getPropertyValue("--docs-toc-w")).toBe("200px");
    expect(bodyOf(container).style.getPropertyValue("--docs-side-w")).toBe("360px");
    expect(screen.getByRole("separator", { name: "Resize the sections" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize the settings" })).toBeInTheDocument();
  });

  it("a drag grows a column only into the room the text can spare", async () => {
    listed();
    sized(1400);
    const { container } = mount(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    await screen.findByText("Part §1.1");
    const edge = screen.getByRole("separator", { name: "Resize the settings" });
    const side = screen.getByRole("complementary", { name: "Document settings" });
    side.getBoundingClientRect = () => ({ width: 300 }) as DOMRect;
    fireEvent.pointerDown(edge, { clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(edge, { clientX: 700, pointerId: 1 });
    expect(bodyOf(container).style.getPropertyValue("--docs-side-w")).toBe("400px");
    fireEvent.pointerUp(edge, { pointerId: 1 });
    expect(bodyOf(container)).toHaveClass("is-wide");
    localStorage.removeItem("testimus.docsSideWidth");
  });
});

describe("Documents screen folding", () => {
  it("wide: the list stays beside the text, at the width last chosen by its edge; no drawer buttons", async () => {
    listed();
    localStorage.setItem("testimus.docsListWidth", "300");
    const { container } = mount(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    localStorage.removeItem("testimus.docsListWidth");
    await screen.findByText("Part §1.1");
    expect(bodyOf(container)).toHaveClass("is-wide");
    expect(bodyOf(container).style.getPropertyValue("--docs-list-w")).toBe("300px");
    expect(screen.getByRole("separator", { name: "Resize the document list" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show the document list" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sections" })).toBeNull();
  });

  it("medium: the list is a drawer opened from the detail; a pick, Escape, the scrim or the button closes it", async () => {
    listed();
    const body = sized(1100);
    const { container, app: a } = mount(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    await screen.findByText("Part §1.1");
    const box = bodyOf(container);
    expect(box).toHaveClass("is-medium");
    expect(box).not.toHaveClass("is-list-open");
    expect(screen.queryByRole("separator", { name: "Resize the document list" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sections" })).toBeNull();
    const show = screen.getByRole("button", { name: "Show the document list" });
    expect(show).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(show);
    expect(box).toHaveClass("is-list-open");
    expect(show).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(container.querySelector(".docs-scrim") as HTMLElement);
    expect(box).not.toHaveClass("is-list-open");
    expect(container.querySelector(".docs-scrim")).toBeNull();

    fireEvent.click(show);
    fireEvent.keyDown(window, { key: "x" });
    expect(box).toHaveClass("is-list-open");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(box).not.toHaveClass("is-list-open");

    fireEvent.click(show);
    fireEvent.click(show);
    expect(box).not.toHaveClass("is-list-open");

    fireEvent.click(show);
    const rows = within(screen.getByRole("region", { name: "Document list" })).getAllByRole("row");
    fireEvent.click(rows[2]);
    expect(a.navigate).toHaveBeenCalledWith("documents", "D2");
    expect(box).not.toHaveClass("is-list-open");

    fireEvent.click(show);
    body.resize(1400);
    expect(box).toHaveClass("is-wide");
    expect(box).not.toHaveClass("is-list-open");
    expect(screen.queryByRole("button", { name: "Show the document list" })).toBeNull();
    cleanup();
    expect(body.disconnect).toHaveBeenCalled();
  });

  it("a folded screen without a document to show offers to open the list", async () => {
    listed();
    sized(900);
    const { container } = mount(<DocumentsScreen />, { route: { screen: "documents", arg: "NOPE" } });
    await screen.findByText("Title D1");
    expect(screen.queryByRole("region", { name: / details$/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the document list" }));
    expect(bodyOf(container)).toHaveClass("is-list-open");
  });

  it("small: Details opens the settings as a drawer; the button, Escape, the scrim or a wider screen closes it", async () => {
    listed({ warnings: ["2 comments dropped"] });
    const body = sized(900);
    const { container } = mount(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    await screen.findByText("Part §1.1");
    expect(bodyOf(container)).toHaveClass("is-small");
    expect(screen.queryByRole("button", { name: "Sections" })).toBeNull();
    const region = screen.getByRole("region", { name: "C-D1 details" });
    const details = within(region).getByRole("button", { name: "Details" });
    expect(details).toHaveAttribute("aria-expanded", "false");
    expect(details.querySelector(".docdoc-dot")).toHaveAttribute("title", "Conversion warnings");

    fireEvent.click(details);
    expect(region).toHaveClass("is-details-open");
    expect(details).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(region.querySelector(".docs-scrim") as HTMLElement);
    expect(region).not.toHaveClass("is-details-open");

    fireEvent.click(details);
    fireEvent.click(details);
    expect(region).not.toHaveClass("is-details-open");

    fireEvent.click(details);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(region).toHaveClass("is-details-open");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(region).not.toHaveClass("is-details-open");

    fireEvent.click(details);
    body.resize(1100);
    expect(region).not.toHaveClass("is-details-open");
    expect(within(region).queryByRole("button", { name: "Details" })).toBeNull();
  });

  it("tiny: Sections opens the structure as a drawer; a picked section, the scrim, Escape or a wider screen closes it", async () => {
    listed();
    const body = sized(600);
    const { container, app: a } = mount(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    await screen.findByText("Part §1.1");
    expect(bodyOf(container)).toHaveClass("is-tiny");
    const region = screen.getByRole("region", { name: "C-D1 details" });
    const sections = within(region).getByRole("button", { name: "Sections" });
    const details = within(region).getByRole("button", { name: "Details" });
    expect(details.querySelector(".docdoc-dot")).toBeNull();
    expect(sections).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(sections);
    expect(region).toHaveClass("is-sections-open");
    expect(sections).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(region.querySelector(".docs-scrim") as HTMLElement);
    expect(region).not.toHaveClass("is-sections-open");

    fireEvent.click(sections);
    fireEvent.click(details);
    expect(region).not.toHaveClass("is-sections-open");
    expect(region).toHaveClass("is-details-open");
    fireEvent.click(sections);
    expect(region).toHaveClass("is-sections-open");

    const toc = within(region).getByRole("navigation", { name: "Sections" });
    fireEvent.click(within(toc).getByRole("button", { name: "1 One" }));
    expect(a.navigate).toHaveBeenCalledWith("documents", "D1#§1");
    expect(region).not.toHaveClass("is-sections-open");

    fireEvent.click(sections);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(region).not.toHaveClass("is-sections-open");

    fireEvent.click(sections);
    body.resize(900);
    expect(region).not.toHaveClass("is-sections-open");
    expect(within(region).queryByRole("button", { name: "Sections" })).toBeNull();
    expect(within(region).getByRole("button", { name: "Details" })).toBeInTheDocument();
  });
});

describe("Claude actions on documents", () => {
  const action = (o: Partial<Action> = {}): Action => ({
    id: "act-1",
    title: "Recover the figures",
    scope: { kind: "doc", docId: "D1" },
    where: "doc:D1",
    problem: "2 comments dropped",
    why: "The PDF has them.",
    plan: ["Convert again"],
    stamp: "s",
    proposedBy: { run: "import", model: "opus", effort: "low", at },
    state: "open",
    at,
    stale: false,
    ...o,
  });

  it("the list row shows a document's first action; the settings put it beside the warning it fixes", async () => {
    listed({ warnings: ["2 comments dropped", "1 table split"] });
    const all = [
      action(),
      action({ id: "act-2", title: "Second", problem: "other" }),
      action({ id: "x", where: "test:T" }),
    ];
    api.routes["actions.list"] = (i) => (i.docId ? all.filter((a) => a.where === `doc:${i.docId}`) : all);
    mount(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    const list = await screen.findByRole("region", { name: "Document list" });
    expect(await within(list).findByRole("button", { name: "Recover the figures" })).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: "Second" })).toBeNull();
    const settings = await screen.findByRole("complementary", { name: "Document settings" });
    const fix = await within(settings).findByRole("button", { name: "Recover the figures" });
    expect(fix.closest(".docdoc-warn")).toHaveTextContent("2 comments dropped");
    const other = within(settings).getByText("1 table split").closest(".docdoc-warn") as HTMLElement;
    expect(within(other).queryByRole("button")).toBeNull();
  });
});

describe("DocDetail folded", () => {
  it("a document that cannot be opened still offers the list", async () => {
    const onShowList = vi.fn();
    mount(
      <DocDetail
        id="DX"
        anchor=""
        fold="medium"
        listOpen
        onShowList={onShowList}
        onAnchor={vi.fn()}
        onChanged={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    expect(await screen.findByText("This document could not be opened")).toBeInTheDocument();
    const show = screen.getByRole("button", { name: "Show the document list" });
    expect(show).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(show);
    expect(onShowList).toHaveBeenCalled();
  });

  it("a document not converted yet has Details but no Sections when tiny", async () => {
    api.routes["docs.show"] = () => ({
      doc: doc("D3", { convertedAt: "" }),
      context: "",
      toc: [],
      requirements: [],
      figures: [],
      md: "",
    });
    mount(<DocDetail id="D3" anchor="" fold="tiny" onAnchor={vi.fn()} onChanged={vi.fn()} onRemoved={vi.fn()} />);
    expect(await screen.findByText("Not converted yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sections" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
  });
});
